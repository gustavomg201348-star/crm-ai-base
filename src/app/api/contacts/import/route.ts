import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import {
  contactInclude,
  getContactNormalizedPhone,
  mapContact,
  type LeadTemperature
} from "@/lib/contacts";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";

type CsvRow = Record<string, string>;

const headerAliases: Record<string, string[]> = {
  name: ["nome", "name", "cliente", "contato"],
  phone: ["telefone", "phone", "celular", "whatsapp", "fone"],
  email: ["email", "e-mail"],
  cpf: ["cpf", "documento"],
  origin: ["origem", "origin", "fonte"],
  stage: ["etapa", "stage", "funil", "status_funil"],
  owner: ["responsavel", "responsável", "owner", "agente", "usuario", "usuário"],
  tags: ["tags", "tag", "segmento", "segmentos"],
  temperature: ["temperatura", "temperature", "score"]
};

const tagColors = ["#0f766e", "#d97706", "#be185d", "#2563eb", "#16a34a"];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function onlyDigits(value?: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if ((char === "," || char === ";") && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells.map((cell) => cell.replace(/^"|"$/g, ""));
}

function parseCsv(csv: string) {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map(normalize);
  const rows: CsvRow[] = [];

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = cells[index]?.trim() ?? "";
    });
    rows.push(row);
  }

  return rows;
}

function readField(row: CsvRow, field: keyof typeof headerAliases) {
  const aliases = headerAliases[field].map(normalize);
  const key = Object.keys(row).find((item) => aliases.includes(item));
  return key ? row[key]?.trim() ?? "" : "";
}

function parseTemperature(value: string): LeadTemperature {
  const normalized = normalize(value);

  if (["hot", "quente", "alto", "alta"].includes(normalized)) return "HOT";
  if (["cold", "frio", "baixa", "baixo"].includes(normalized)) return "COLD";

  return "WARM";
}

function splitTags(value: string) {
  return value
    .split(/[|,;]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as
      | { csv?: string; defaults?: { originId?: string; stageId?: string; ownerId?: string } }
      | null;
    const rows = parseCsv(body?.csv ?? "");

    if (!rows.length) {
      return NextResponse.json(
        { error: "CSV vazio ou sem linhas de contato." },
        { status: 400 }
      );
    }

    const [origins, stages, users, tags, existingContacts] = await Promise.all([
      prisma.origin.findMany({ where: { companyId: session.companyId } }),
      prisma.pipelineStage.findMany({ where: { companyId: session.companyId } }),
      prisma.user.findMany({ where: { companyId: session.companyId } }),
      prisma.tag.findMany({ where: { companyId: session.companyId } }),
      prisma.contact.findMany({
        where: { companyId: session.companyId },
        select: { cpf: true, phone: true }
      })
    ]);

    const originMap = new Map(origins.map((origin) => [normalize(origin.name), origin.id]));
    const stageMap = new Map(stages.map((stage) => [normalize(stage.name), stage.id]));
    const userMap = new Map([
      ...users.map((user) => [normalize(user.name), user.id] as const),
      ...users.map((user) => [normalize(user.email), user.id] as const)
    ]);
    const tagMap = new Map(tags.map((tag) => [normalize(tag.name), tag]));
    const knownPhones = new Set(existingContacts.map((contact) => onlyDigits(contact.phone)).filter(Boolean));
    const knownCpfs = new Set(existingContacts.map((contact) => onlyDigits(contact.cpf)).filter(Boolean));
    const seenPhones = new Set<string>();
    const seenCpfs = new Set<string>();
    const errors: Array<{ row: number; reason: string }> = [];
    const ignored: Array<{ row: number; reason: string }> = [];
    const createdContacts = [];

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rowNumber = index + 2;
      const name = readField(row, "name");
      const phone = readField(row, "phone");
      const email = readField(row, "email");
      const cpf = readField(row, "cpf");
      const normalizedPhone = onlyDigits(phone);
      const normalizedCpf = onlyDigits(cpf);
      const contactNormalizedPhone = getContactNormalizedPhone(phone);

      if (!name || !phone) {
        errors.push({ row: rowNumber, reason: "Nome e telefone sao obrigatorios." });
        continue;
      }

      if (
        (normalizedPhone && (knownPhones.has(normalizedPhone) || seenPhones.has(normalizedPhone))) ||
        (normalizedCpf && (knownCpfs.has(normalizedCpf) || seenCpfs.has(normalizedCpf)))
      ) {
        ignored.push({ row: rowNumber, reason: "Contato duplicado por telefone ou CPF." });
        continue;
      }

      const originName = readField(row, "origin");
      const stageName = readField(row, "stage");
      const ownerName = readField(row, "owner");
      const tagNames = splitTags(readField(row, "tags"));
      const rowTags = [];

      for (const tagName of tagNames) {
        const key = normalize(tagName);
        let tag = tagMap.get(key);

        if (!tag) {
          tag = await prisma.tag.create({
            data: {
              companyId: session.companyId,
              name: tagName,
              color: tagColors[tagMap.size % tagColors.length]
            }
          });
          tagMap.set(key, tag);
        }

        rowTags.push(tag);
      }

      const contact = await prisma.contact.create({
        data: {
          companyId: session.companyId,
          ownerId: (ownerName && userMap.get(normalize(ownerName))) || body?.defaults?.ownerId || session.id,
          name,
          phone,
          normalizedPhone: contactNormalizedPhone,
          email: email || null,
          cpf: cpf || null,
          originId: (originName && originMap.get(normalize(originName))) || body?.defaults?.originId || null,
          stageId: (stageName && stageMap.get(normalize(stageName))) || body?.defaults?.stageId || null,
          temperature: parseTemperature(readField(row, "temperature")),
          tags: rowTags.length
            ? { create: rowTags.map((tag) => ({ tagId: tag.id })) }
            : undefined
        },
        include: contactInclude
      });

      if (normalizedPhone) seenPhones.add(normalizedPhone);
      if (normalizedCpf) seenCpfs.add(normalizedCpf);
      createdContacts.push(mapContact(contact));
    }

    return NextResponse.json({
      summary: {
        totalRows: rows.length,
        created: createdContacts.length,
        ignored: ignored.length,
        errors: errors.length
      },
      contacts: createdContacts,
      ignored,
      errors
    });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel importar contatos." },
      { status: 500 }
    );
  }
}
