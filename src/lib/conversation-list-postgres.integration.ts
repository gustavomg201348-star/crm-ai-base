import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { conversationListQuery, createConversationListGetHandler, getConversationList } from "./conversation-list.service";
import type { SessionUser } from "./auth";

const url = new URL(process.env.DATABASE_URL ?? "file:invalid");
if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true" || process.env.CONVERSATION_LIST_POSTGRES_TEST !== "1"
  || url.protocol !== "postgresql:" || !["localhost", "127.0.0.1"].includes(url.hostname) || !["5432", "55432"].includes(url.port)
  || url.pathname !== "/qevora_ci" || url.username !== "qevora_ci" || url.password !== "qevora_ci_password"
  || url.search !== "?schema=public" || url.hash) throw Error("CONVERSATION_LIST_REQUIRES_DISPOSABLE_CI");
const db = new PrismaClient({ log: [] });
after(() => db.$disconnect());
async function fixture(size = 250) {
  const company = await db.company.create({ data: { name: "Synthetic list fixture" } });
  const suffix = randomUUID();
  const users = await Promise.all(["me", "other"].map(x => db.user.create({ data: {
    companyId: company.id, name: "Synthetic", email: x + suffix + "@example.invalid", passwordHash: "synthetic", role: "AGENT",
  } })));
  const actor: SessionUser = { ...users[0], role: "ADMIN" };
  const contacts = Array.from({ length: size }, (_, n) => ({ id: `ct-${suffix}-${n}`, companyId: company.id,
    name: n % 2 ? "Synthetic Beta" : "Synthetic Alpha", phone: "synthetic-phone-" + n }));
  const rows = contacts.map((c, n) => ({ id: `cv-${suffix}-${String(n).padStart(6, "0")}`, contactId: c.id,
    channel: "whatsapp", status: "OPEN", agentId: n % 3 === 0 ? null : users[n % 3 === 1 ? 0 : 1].id,
    createdAt: new Date("2024-01-01T00:00:00Z"), lastMessageAt: new Date(Date.parse("2025-01-01T00:00:00Z") + Math.floor(n / 3) * 1000) as Date | null }));
  rows[size - 1].lastMessageAt = null; rows[size - 1].createdAt = new Date("2026-11-01T00:00:00Z");
  for (let start = 0; start < size; start += 1000) {
    await db.contact.createMany({ data: contacts.slice(start, start + 1000) });
    await db.conversation.createMany({ data: rows.slice(start, start + 1000) });
  }
  const snapshot = () => Promise.all([db.conversation.findMany({ where: { contact: { companyId: company.id } }, orderBy: { id: "asc" } }),
    db.contact.count({ where: { companyId: company.id } }), db.channel.count({ where: { companyId: company.id } }),
    db.message.count({ where: { conversation: { contact: { companyId: company.id } } } })]);
  return { company, actor, users, contacts, rows, snapshot,
    async cleanup() {
      await db.conversationTag.deleteMany({ where: { companyId: company.id } });
      await db.tag.deleteMany({ where: { companyId: company.id } });
      await db.conversation.deleteMany({ where: { contact: { companyId: company.id } } });
      await db.contact.deleteMany({ where: { companyId: company.id } });
      await db.user.deleteMany({ where: { companyId: company.id } });
      await db.company.delete({ where: { id: company.id } });
    } };
}
type F = Awaited<ReturnType<typeof fixture>>;
function pg(name: string, work: (f: F) => Promise<void>) {
  test(name, async () => { const f = await fixture(); try { await work(f); } finally { await f.cleanup(); } });
}
async function all(actor: SessionUser, query = "") {
  const rows = []; const pages = []; let cursor: string | null = null;
  do {
    const params = new URLSearchParams(query); if (cursor) params.set("cursor", cursor);
    const page = await getConversationList(db, actor, params); rows.push(...page.conversations); pages.push(page);
    cursor = page.nextCursor; assert.equal(page.hasMore, cursor !== null);
    assert(pages.length <= 10);
  } while (cursor);
  return { rows, pages };
}
pg("250 rows paginate 100/100/50; new message-free conversation beats 249 older messaged rows", async f => {
  const before = await f.snapshot(); const result = await all(f.actor);
  assert.deepEqual(result.pages.map(x => x.conversations.length), [100, 100, 50]);
  assert.deepEqual(result.pages.map(x => x.hasMore), [true, true, false]);
  assert.equal(result.rows[0].id, f.rows[249].id); assert.equal(result.rows[0].lastMessageAt, null);
  assert.deepEqual(result.rows[0].messages, []);
  const expected = [...f.rows].sort((a, b) => (b.lastMessageAt ?? b.createdAt).getTime() - (a.lastMessageAt ?? a.createdAt).getTime()
    || (a.id < b.id ? 1 : -1));
  assert.deepEqual(result.rows.map(x => x.id), expected.map(x => x.id));
  assert.equal(new Set(result.rows.map(x => x.id)).size, 250);
  assert(result.pages.every(p => p.statusCounts.OPEN === 250));
  assert.equal(result.pages[2].nextCursor, null); assert.deepEqual(await f.snapshot(), before);
});
pg("internal OpenCredit conversation stays hidden while WhatsApp conversation remains visible", async f => {
  const contact = f.contacts[0];
  const internalChannel = await db.channel.create({ data: {
    companyId: f.company.id, name: "OpenCredit", type: "OPEN_CREDIT", provider: "internal",
  } });
  const internal = await db.conversation.create({ data: {
    contactId: contact.id, channelId: internalChannel.id, channel: "OPEN_CREDIT", status: "OPEN",
    summary: "Lead recebido via OpenCredit", createdAt: new Date("2027-02-01T00:00:00Z"),
  } });
  const result = await all(f.actor, "status=OPEN");
  assert(!result.rows.some(x => x.id === internal.id));
  assert(result.rows.some(x => x.id === f.rows[0].id));
  assert(result.pages.every(p => p.statusCounts.OPEN === 250));
  const persisted = await db.conversation.findUnique({ where: { id: internal.id } });
  assert.equal(persisted?.channel, "OPEN_CREDIT");
  assert.equal(persisted?.channelId, internalChannel.id);
});

pg("A recent message, B newer created-only and C old follow exact effective activity; ties cross page boundaries", async f => {
  const [a,b,c] = f.rows;
  await db.conversation.update({ where: { id: a.id }, data: { lastMessageAt: new Date("2027-01-02T00:00:00Z") } });
  await db.conversation.update({ where: { id: b.id }, data: { lastMessageAt: null, createdAt: new Date("2027-01-03T00:00:00Z") } });
  const p = await getConversationList(db,f.actor,new URLSearchParams("limit=2"));
  assert.deepEqual(p.conversations.map(x=>x.id),[b.id,a.id]); assert(!p.conversations.some(x=>x.id===c.id));
});
pg("status filter is paginated while counts remain totals of base filters", async f => {
  await db.conversation.updateMany({ where: { id: { in: f.rows.slice(0, 120).map(x => x.id) } }, data: { status: "PENDING" } });
  const result = await all(f.actor, "status=PENDING&limit=50");
  assert.deepEqual(result.pages.map(x=>x.conversations.length),[50,50,20]);
  assert(result.rows.every(x=>x.status==="PENDING"));
  assert(result.pages.every(x=>x.statusCounts.PENDING===120 && x.statusCounts.OPEN===130));
});
pg("assignedTo, search and active tenant-bound tags retain the same base and SQL filters", async f => {
  const tag=await db.tag.create({data:{companyId:f.company.id,name:"Synthetic tag",color:"#123456"}});
  await db.conversationTag.createMany({data:f.rows.filter((_,i)=>i%2===0).map(x=>({companyId:f.company.id,conversationId:x.id,tagId:tag.id}))});
  for(const assigned of ["me","unassigned",f.users[1].id]) {
    const result=await all(f.actor,`search=Alpha&tagIds=${tag.id}&assignedTo=${assigned}&limit=30`);
    const expected=f.rows.filter((_,i)=>i%2===0).filter(x=>x.agentId===(assigned==="me"?f.users[0].id:assigned==="unassigned"?null:f.users[1].id));
    assert.equal(result.rows.length,expected.length); assert(result.rows.every(x=>x.contact.name==="Synthetic Alpha"));
    assert.deepEqual(result.rows.map(x=>x.id).sort(),expected.map(x=>x.id).sort());
    assert(result.pages.every(x=>x.statusCounts.OPEN===expected.length));
  }
  assert.equal((await all(f.actor,"search=%27%20OR%201%3D1%20--")).rows.length,0);
  await db.tag.update({where:{id:tag.id},data:{isActive:false}});
  assert.equal((await all(f.actor,`tagId=${tag.id}`)).rows.length,0);
});
pg("tenant, archived contacts and agent visibility cannot be bypassed with owner filters/cursors", async f => {
  const foreign=await fixture(2);
  try {
    const foreignTag=await db.tag.create({data:{companyId:foreign.company.id,name:"Synthetic foreign tag",color:"#123456"}});
    await db.conversationTag.create({data:{companyId:foreign.company.id,conversationId:foreign.rows[0].id,tagId:foreignTag.id}});
    assert.equal((await all(f.actor,"tagId="+foreignTag.id)).rows.length,0);
    await db.contact.update({where:{id:f.contacts[0].id},data:{archivedAt:new Date()}});
    const actor={...f.actor,role:"AGENT" as const};
    const result=await all(actor,"assignedTo="+f.users[1].id);
    const expected=f.rows.filter((x,i)=>i!==0&&(x.agentId===null||x.agentId===actor.id));
    assert.equal(result.rows.length,expected.length);
    assert(!result.rows.some(x=>foreign.rows.some(y=>y.id===x.id)));
    const page=await getConversationList(db,f.actor,new URLSearchParams("limit=2"));
    for(const changed of [{...f.actor,companyId:foreign.company.id},{...f.actor,id:f.users[1].id},{...f.actor,role:"AGENT" as const}]) {
      await assert.rejects(getConversationList(db,changed,new URLSearchParams({limit:"2",cursor:page.nextCursor!})));
    }
  } finally { await foreign.cleanup(); }
});
pg("HTTP cursor is tamper-resistant, filter/limit-bound, bounded and does not write", async f => {
  const handler=createConversationListGetHandler({db,getSession:async()=>f.actor});
  const first=await handler(new NextRequest("https://crm.example/api/conversations?limit=10000"));
  assert.equal(first.status,200); const p=await first.json();assert.equal(p.conversations.length,100);
  for(const query of [new URLSearchParams({cursor:p.nextCursor+"x"}),new URLSearchParams({cursor:p.nextCursor,status:"ALL"}),
    new URLSearchParams({cursor:p.nextCursor,search:"Alpha"}),new URLSearchParams({cursor:p.nextCursor,limit:"99"})]) {
    assert.equal((await handler(new NextRequest("https://crm.example/api/conversations?"+query))).status,400);
  }
  assert.equal(await db.message.count({where:{conversation:{contact:{companyId:f.company.id}}}}),0);
});
pg("cursor boundaries preserve every row with a non-UTC PostgreSQL session", async f => {
  const client = { $transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'America/Sao_Paulo'");
    return work(tx);
  }, options) } as Pick<PrismaClient, "$transaction">;
  const collected: string[] = []; let cursor: string | null = null;
  for (let page = 0; page < 3; page++) {
    const params = new URLSearchParams(); if (cursor) params.set("cursor", cursor);
    const result = await getConversationList(client, f.actor, params);
    collected.push(...result.conversations.map(x => x.id)); cursor = result.nextCursor;
  }
  assert.equal(cursor, null); assert.equal(collected.length, 250); assert.equal(new Set(collected).size, 250);
  assert.deepEqual(collected, (await all(f.actor)).rows.map(x => x.id));
});
test("representative PostgreSQL EXPLAIN on 20,000 conversations, no new index", async () => {
  const f=await fixture(20000);
  try {
    await db.$executeRaw`ANALYZE "Conversation"`; await db.$executeRaw`ANALYZE "Contact"`;
    const q=conversationListQuery(f.actor,new URLSearchParams());
    const result=await db.$queryRaw<Array<{"QUERY PLAN":Array<{Plan:Record<string,unknown>;"Execution Time":number}>}>>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q.query}`);
    const plan=result[0]["QUERY PLAN"][0];
    assert.equal(plan.Plan["Node Type"],"Limit"); assert.equal(plan.Plan["Actual Rows"],101);
    const nodes: Array<{node:unknown;rows:unknown;sort:unknown}>=[];
    const walk=(node:Record<string,unknown>):void=>{nodes.push({node:node["Node Type"],rows:node["Actual Rows"],sort:node["Sort Method"]??null});for(const child of (node.Plans??[]) as Array<Record<string,unknown>>)walk(child);};
    walk(plan.Plan);
    console.log(JSON.stringify({event:"conversation_list_fixture_plan",rows:20000,node:plan.Plan["Node Type"],returned:plan.Plan["Actual Rows"],executionMs:plan["Execution Time"],nodes}));
    const started=Date.now(); const page=await getConversationList(db,f.actor,new URLSearchParams());
    assert.equal(page.conversations.length,100);assert.equal(page.statusCounts.OPEN,20000);
    console.log(JSON.stringify({event:"conversation_list_fixture_request",rows:20000,elapsedMs:Date.now()-started}));
  } finally { await f.cleanup(); }
});
