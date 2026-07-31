import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand
} from "@aws-sdk/client-s3";
import {
  deleteTemplateMedia,
  readTemplateMedia,
  saveTemplateHeaderMedia,
  TemplateMediaStorageError
} from "./template-media-storage";
import {
  resetTemplateMediaR2ClientCacheForTests,
  setTemplateMediaR2ClientFactoryForTests
} from "./template-media-storage-r2";

const pngBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
]);

function r2Config() {
  return {
    bucket: "templates",
    endpoint: "https://example-r2.invalid",
    region: "auto",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    publicBaseUrl: null
  };
}

function abortedPromise(signal?: AbortSignal) {
  return new Promise<never>((_resolve, reject) => {
    signal?.addEventListener(
      "abort",
      () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      },
      { once: true }
    );
  });
}

test("salva, le e exclui midia local preservando checksum, MIME e tamanho", async () => {
  const publicRootDir = await mkdtemp(path.join(os.tmpdir(), "template-media-local-"));

  try {
    const stored = await saveTemplateHeaderMedia(
      {
        fileName: "clt disparo 03.png",
        mimeType: "image/png",
        bytes: pngBytes,
        namespace: "company-1"
      },
      {
        provider: "local",
        publicRootDir,
        publicBaseUrl: "https://crm.example.test"
      }
    );

    assert.equal(stored.storageProvider, "local");
    assert.equal(stored.mimeType, "image/png");
    assert.equal(stored.sizeBytes, pngBytes.byteLength);
    assert.equal(stored.checksum.length, 64);
    assert.match(stored.storageKey, /^templates\/company-1\/[a-f0-9]{2}\/[a-f0-9]{64}\.png$/);
    assert.match(stored.publicUrl ?? "", /^https:\/\/crm\.example\.test\/templates\//);

    const read = await readTemplateMedia(
      {
        storageProvider: stored.storageProvider,
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        fileName: stored.originalFileName
      },
      { publicRootDir }
    );

    assert.deepEqual(read.bytes, pngBytes);
    assert.equal(read.mimeType, "image/png");
    assert.equal(read.fileName, "clt disparo 03.png");
    assert.equal(read.sizeBytes, pngBytes.byteLength);

    const deleted = await deleteTemplateMedia(
      {
        storageProvider: stored.storageProvider,
        storageKey: stored.storageKey
      },
      { publicRootDir }
    );

    assert.equal(deleted.deleted, true);
  } finally {
    await rm(publicRootDir, { force: true, recursive: true });
  }
});

test("bloqueia path traversal no storage local", async () => {
  await assert.rejects(
    () =>
      readTemplateMedia({
        storageProvider: "local",
        storageKey: "../secret.png"
      }),
    (error) =>
      error instanceof TemplateMediaStorageError &&
      error.code === "STORAGE_INVALID_KEY"
  );
});

test("retorna erro tipado para arquivo local inexistente", async () => {
  const publicRootDir = await mkdtemp(path.join(os.tmpdir(), "template-media-missing-"));

  try {
    await assert.rejects(
      () =>
        readTemplateMedia(
          {
            storageProvider: "local",
            storageKey: "templates/company-1/aa/missing.png"
          },
          { publicRootDir }
        ),
      (error) =>
        error instanceof TemplateMediaStorageError &&
        error.code === "STORAGE_FILE_NOT_FOUND"
    );
  } finally {
    await rm(publicRootDir, { force: true, recursive: true });
  }
});

test("retorna erro tipado para arquivo local vazio", async () => {
  const publicRootDir = await mkdtemp(path.join(os.tmpdir(), "template-media-empty-"));
  const storageKey = "templates/company-1/aa/empty.png";

  try {
    await mkdir(path.dirname(path.join(publicRootDir, storageKey)), { recursive: true });
    await writeFile(path.join(publicRootDir, storageKey), Buffer.alloc(0), {
      flag: "wx"
    }).catch(async () => {
      await rm(path.join(publicRootDir, storageKey), { force: true });
      await writeFile(path.join(publicRootDir, storageKey), Buffer.alloc(0));
    });

    await assert.rejects(
      () =>
        readTemplateMedia(
          {
            storageProvider: "local",
            storageKey
          },
          { publicRootDir }
        ),
      (error) =>
        error instanceof TemplateMediaStorageError &&
        error.code === "STORAGE_EMPTY_FILE"
    );
  } finally {
    await rm(publicRootDir, { force: true, recursive: true });
  }
});

test("rejeita provider invalido sem expor configuracao sensivel", async () => {
  await assert.rejects(
    () =>
      saveTemplateHeaderMedia(
        {
          fileName: "image.png",
          mimeType: "image/png",
          bytes: pngBytes,
          namespace: "company-1"
        },
        { provider: "invalid-provider" }
      ),
    (error) =>
      error instanceof TemplateMediaStorageError &&
      error.code === "STORAGE_PROVIDER_NOT_CONFIGURED"
  );
});

test("usa comandos R2/S3 para salvar, ler e excluir sem URL publica obrigatoria", async () => {
  const commands: Array<PutObjectCommand | GetObjectCommand | DeleteObjectCommand> = [];
  const r2Client = {
    async send(command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand) {
      commands.push(command);

      if (command instanceof GetObjectCommand) {
        return {
          Body: pngBytes,
          ContentType: "image/png",
          ContentLength: pngBytes.byteLength
        };
      }

      return {};
    }
  };

  const stored = await saveTemplateHeaderMedia(
    {
      fileName: "image.png",
      mimeType: "image/png",
      bytes: pngBytes,
      namespace: "company-1"
    },
    {
      provider: "r2",
      r2Client,
      r2Config: r2Config()
    }
  );

  assert.equal(stored.storageProvider, "r2");
  assert.equal(stored.publicUrl, null);
  assert.match(stored.storageKey, /^templates\/company-1\/[a-f0-9]{2}\/[a-f0-9]{64}\.png$/);

  const read = await readTemplateMedia(
    {
      storageProvider: stored.storageProvider,
      storageKey: stored.storageKey,
      mimeType: stored.mimeType,
      fileName: stored.originalFileName
    },
    {
      r2Client,
      r2Config: r2Config()
    }
  );

  assert.deepEqual(read.bytes, pngBytes);
  assert.equal(read.mimeType, "image/png");
  assert.equal(read.sizeBytes, pngBytes.byteLength);

  await deleteTemplateMedia(
    {
      storageProvider: stored.storageProvider,
      storageKey: stored.storageKey
    },
    {
      r2Client,
      r2Config: r2Config()
    }
  );

  assert.equal(commands.some((command) => command instanceof PutObjectCommand), true);
  assert.equal(commands.some((command) => command instanceof GetObjectCommand), true);
  assert.equal(commands.some((command) => command instanceof DeleteObjectCommand), true);
});

test("reutiliza S3Client para a mesma configuracao R2 e recria quando a configuracao muda", async () => {
  resetTemplateMediaR2ClientCacheForTests();
  const clients: unknown[] = [];
  const commands: Array<PutObjectCommand | GetObjectCommand | DeleteObjectCommand> = [];

  setTemplateMediaR2ClientFactoryForTests(() => {
    const client = {
      async send(command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand) {
        commands.push(command);

        if (command instanceof GetObjectCommand) {
          return {
            Body: pngBytes,
            ContentType: "image/png",
            ContentLength: pngBytes.byteLength
          };
        }

        return {};
      }
    };

    clients.push(client);
    return client;
  });

  try {
    const stored = await saveTemplateHeaderMedia(
      {
        fileName: "image.png",
        mimeType: "image/png",
        bytes: pngBytes,
        namespace: "company-1"
      },
      {
        provider: "r2",
        r2Config: r2Config()
      }
    );

    await readTemplateMedia(
      {
        storageProvider: stored.storageProvider,
        storageKey: stored.storageKey
      },
      { r2Config: r2Config() }
    );

    await deleteTemplateMedia(
      {
        storageProvider: stored.storageProvider,
        storageKey: stored.storageKey
      },
      { r2Config: r2Config() }
    );

    assert.equal(clients.length, 1);
    assert.equal(commands.length, 3);

    await saveTemplateHeaderMedia(
      {
        fileName: "image.png",
        mimeType: "image/png",
        bytes: pngBytes,
        namespace: "company-1"
      },
      {
        provider: "r2",
        r2Config: {
          ...r2Config(),
          bucket: "templates-other"
        }
      }
    );

    assert.equal(clients.length, 2);
  } finally {
    resetTemplateMediaR2ClientCacheForTests();
  }
});

test("aplica timeout R2 configurado e retorna erro seguro sem segredo", async () => {
  let signalReceived: AbortSignal | undefined;
  const r2Client = {
    async send(
      _command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand,
      options?: { abortSignal?: AbortSignal }
    ) {
      signalReceived = options?.abortSignal;
      return abortedPromise(options?.abortSignal);
    }
  };

  await assert.rejects(
    () =>
      saveTemplateHeaderMedia(
        {
          fileName: "image.png",
          mimeType: "image/png",
          bytes: pngBytes,
          namespace: "company-1"
        },
        {
          provider: "r2",
          r2Client,
          r2Config: {
            ...r2Config(),
            timeoutMs: 1_000
          }
        }
      ),
    (error) => {
      assert.equal(signalReceived?.aborted, true);
      assert.equal(error instanceof TemplateMediaStorageError, true);
      const storageError = error as TemplateMediaStorageError;
      assert.equal(storageError.code, "STORAGE_OPERATION_TIMEOUT");
      assert.equal(storageError.context?.operation, "put");
      assert.equal(storageError.context?.storageProvider, "r2");
      assert.equal(storageError.context?.timeoutMs, 1_000);
      assert.deepEqual(storageError.toJSON(), {
        code: "STORAGE_OPERATION_TIMEOUT",
        message: "Operacao de storage R2 excedeu o tempo limite."
      });
      assert.equal(JSON.stringify(storageError).includes("test-secret-key"), false);
      assert.equal(JSON.stringify(storageError).includes("test-access-key"), false);
      return true;
    }
  );
});

test("aplica timeout R2 configurado em leitura e exclusao", async () => {
  const r2Client = {
    async send(
      _command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand,
      options?: { abortSignal?: AbortSignal }
    ) {
      return abortedPromise(options?.abortSignal);
    }
  };

  await assert.rejects(
    () =>
      readTemplateMedia(
        {
          storageProvider: "r2",
          storageKey: "templates/company-1/aa/image.png",
          mimeType: "image/png"
        },
        {
          r2Client,
          r2Config: {
            ...r2Config(),
            timeoutMs: 1_000
          }
        }
      ),
    (error) =>
      error instanceof TemplateMediaStorageError &&
      error.code === "STORAGE_OPERATION_TIMEOUT" &&
      error.context?.operation === "get"
  );

  await assert.rejects(
    () =>
      deleteTemplateMedia(
        {
          storageProvider: "r2",
          storageKey: "templates/company-1/aa/image.png"
        },
        {
          r2Client,
          r2Config: {
            ...r2Config(),
            timeoutMs: 1_000
          }
        }
      ),
    (error) =>
      error instanceof TemplateMediaStorageError &&
      error.code === "STORAGE_OPERATION_TIMEOUT" &&
      error.context?.operation === "delete"
  );
});

test("limpa timer R2 em sucesso e em erro sem timeout", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Set<Parameters<typeof clearTimeout>[0]>();

  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const timer = originalSetTimeout(handler, timeout, ...args);
    timers.add(timer);
    return timer;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer?: Parameters<typeof clearTimeout>[0]) => {
    if (timer) timers.delete(timer);
    return originalClearTimeout(timer);
  }) as typeof clearTimeout;

  try {
    const successClient = {
      async send(_command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand) {
        return {};
      }
    };

    await saveTemplateHeaderMedia(
      {
        fileName: "image.png",
        mimeType: "image/png",
        bytes: pngBytes,
        namespace: "company-1"
      },
      {
        provider: "r2",
        r2Client: successClient,
        r2Config: r2Config()
      }
    );

    assert.equal(timers.size, 0);

    const errorClient = {
      async send(_command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand) {
        throw new Error("network failed");
      }
    };

    await assert.rejects(() =>
      deleteTemplateMedia(
        {
          storageProvider: "r2",
          storageKey: "templates/company-1/aa/image.png"
        },
        {
          r2Client: errorClient,
          r2Config: r2Config()
        }
      )
    );

    assert.equal(timers.size, 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("usa timeout padrao quando timeout R2 configurado e invalido", async () => {
  const r2Client = {
    async send(
      _command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand,
      options?: { abortSignal?: AbortSignal }
    ) {
      options?.abortSignal?.throwIfAborted();
      return {};
    }
  };

  const stored = await saveTemplateHeaderMedia(
    {
      fileName: "image.png",
      mimeType: "image/png",
      bytes: pngBytes,
      namespace: "company-1"
    },
    {
      provider: "r2",
      r2Client,
      r2Config: {
        ...r2Config(),
        timeoutMs: 999
      }
    }
  );

  assert.equal(stored.storageProvider, "r2");
});
