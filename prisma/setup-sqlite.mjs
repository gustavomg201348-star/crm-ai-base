import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const dbPath = join(process.cwd(), "prisma", "dev.db");

if (!existsSync(dirname(dbPath))) {
  mkdirSync(dirname(dbPath), { recursive: true });
}

const db = new DatabaseSync(dbPath);

db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS Company (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  segment TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS User (
  id TEXT PRIMARY KEY NOT NULL,
  companyId TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'AGENT',
  avatar TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT User_companyId_fkey FOREIGN KEY (companyId) REFERENCES Company (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS User_companyId_idx ON User(companyId);

CREATE TABLE IF NOT EXISTS UserAvailability (
  userId TEXT PRIMARY KEY NOT NULL,
  companyId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OFFLINE',
  lastSeenAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT UserAvailability_companyId_fkey FOREIGN KEY (companyId) REFERENCES Company (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT UserAvailability_userId_fkey FOREIGN KEY (userId) REFERENCES User (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS UserAvailability_companyId_idx ON UserAvailability(companyId);
CREATE INDEX IF NOT EXISTS UserAvailability_status_idx ON UserAvailability(status);

CREATE TABLE IF NOT EXISTS Channel (
  id TEXT PRIMARY KEY NOT NULL,
  companyId TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'whatsapp',
  provider TEXT NOT NULL DEFAULT 'sandbox',
  externalId TEXT,
  phoneNumberId TEXT,
  wabaId TEXT,
  displayPhone TEXT,
  accessToken TEXT,
  verifyToken TEXT,
  appSecret TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT Channel_companyId_fkey FOREIGN KEY (companyId) REFERENCES Company (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS Channel_companyId_idx ON Channel(companyId);

CREATE TABLE IF NOT EXISTS Origin (
  id TEXT PRIMARY KEY NOT NULL,
  companyId TEXT NOT NULL,
  name TEXT NOT NULL,
  CONSTRAINT Origin_companyId_fkey FOREIGN KEY (companyId) REFERENCES Company (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS Origin_companyId_idx ON Origin(companyId);

CREATE TABLE IF NOT EXISTS PipelineStage (
  id TEXT PRIMARY KEY NOT NULL,
  companyId TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  position INTEGER NOT NULL,
  CONSTRAINT PipelineStage_companyId_fkey FOREIGN KEY (companyId) REFERENCES Company (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS PipelineStage_companyId_idx ON PipelineStage(companyId);

CREATE TABLE IF NOT EXISTS Tag (
  id TEXT PRIMARY KEY NOT NULL,
  companyId TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  textColor TEXT DEFAULT '#ffffff',
  category TEXT,
  isActive BOOLEAN NOT NULL DEFAULT true,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT Tag_companyId_fkey FOREIGN KEY (companyId) REFERENCES Company (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS Tag_companyId_idx ON Tag(companyId);

CREATE TABLE IF NOT EXISTS Contact (
  id TEXT PRIMARY KEY NOT NULL,
  companyId TEXT NOT NULL,
  ownerId TEXT,
  stageId TEXT,
  originId TEXT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  cpf TEXT,
  temperature TEXT NOT NULL DEFAULT 'WARM',
  lastMessage TEXT,
  archivedAt DATETIME,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT Contact_companyId_fkey FOREIGN KEY (companyId) REFERENCES Company (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT Contact_ownerId_fkey FOREIGN KEY (ownerId) REFERENCES User (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT Contact_stageId_fkey FOREIGN KEY (stageId) REFERENCES PipelineStage (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT Contact_originId_fkey FOREIGN KEY (originId) REFERENCES Origin (id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS Contact_companyId_idx ON Contact(companyId);
CREATE INDEX IF NOT EXISTS Contact_ownerId_idx ON Contact(ownerId);
CREATE INDEX IF NOT EXISTS Contact_stageId_idx ON Contact(stageId);
CREATE INDEX IF NOT EXISTS Contact_originId_idx ON Contact(originId);

CREATE TABLE IF NOT EXISTS RetirementLead (
  id TEXT PRIMARY KEY NOT NULL,
  companyId TEXT NOT NULL,
  contactId TEXT NOT NULL,
  grantDate DATETIME,
  estimatedUnlockDate DATETIME,
  daysToUnlock INTEGER,
  benefitType TEXT,
  benefitNumber TEXT,
  state TEXT,
  city TEXT,
  desiredAmount DECIMAL,
  interestLevel TEXT NOT NULL DEFAULT 'NONE',
  hasCorrespondent BOOLEAN NOT NULL DEFAULT false,
  score INTEGER NOT NULL DEFAULT 0,
  journeyStatus TEXT NOT NULL DEFAULT 'IMPORTED',
  nextContactDate DATETIME,
  lastContactDate DATETIME,
  notes TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT RetirementLead_companyId_fkey FOREIGN KEY (companyId) REFERENCES Company (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT RetirementLead_contactId_fkey FOREIGN KEY (contactId) REFERENCES Contact (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS RetirementLead_companyId_contactId_key ON RetirementLead(companyId, contactId);
CREATE INDEX IF NOT EXISTS RetirementLead_companyId_idx ON RetirementLead(companyId);
CREATE INDEX IF NOT EXISTS RetirementLead_contactId_idx ON RetirementLead(contactId);
CREATE INDEX IF NOT EXISTS RetirementLead_estimatedUnlockDate_idx ON RetirementLead(estimatedUnlockDate);
CREATE INDEX IF NOT EXISTS RetirementLead_daysToUnlock_idx ON RetirementLead(daysToUnlock);
CREATE INDEX IF NOT EXISTS RetirementLead_score_idx ON RetirementLead(score);
CREATE INDEX IF NOT EXISTS RetirementLead_journeyStatus_idx ON RetirementLead(journeyStatus);
CREATE INDEX IF NOT EXISTS RetirementLead_nextContactDate_idx ON RetirementLead(nextContactDate);

CREATE TABLE IF NOT EXISTS RetirementLeadEvent (
  id TEXT PRIMARY KEY NOT NULL,
  retirementLeadId TEXT NOT NULL,
  eventType TEXT NOT NULL,
  description TEXT,
  createdByUserId TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT RetirementLeadEvent_retirementLeadId_fkey FOREIGN KEY (retirementLeadId) REFERENCES RetirementLead (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT RetirementLeadEvent_createdByUserId_fkey FOREIGN KEY (createdByUserId) REFERENCES User (id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS RetirementLeadEvent_retirementLeadId_idx ON RetirementLeadEvent(retirementLeadId);
CREATE INDEX IF NOT EXISTS RetirementLeadEvent_eventType_idx ON RetirementLeadEvent(eventType);
CREATE INDEX IF NOT EXISTS RetirementLeadEvent_createdByUserId_idx ON RetirementLeadEvent(createdByUserId);
CREATE INDEX IF NOT EXISTS RetirementLeadEvent_createdAt_idx ON RetirementLeadEvent(createdAt);

CREATE TABLE IF NOT EXISTS ContactTag (
  contactId TEXT NOT NULL,
  tagId TEXT NOT NULL,
  PRIMARY KEY (contactId, tagId),
  CONSTRAINT ContactTag_contactId_fkey FOREIGN KEY (contactId) REFERENCES Contact (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ContactTag_tagId_fkey FOREIGN KEY (tagId) REFERENCES Tag (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS Conversation (
  id TEXT PRIMARY KEY NOT NULL,
  contactId TEXT NOT NULL,
  agentId TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  summary TEXT,
  unreadCount INTEGER NOT NULL DEFAULT 0,
  lastMessageAt DATETIME,
  lastMessagePreview TEXT,
  lastInboundMessageAt DATETIME,
  lastReadAt DATETIME,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT Conversation_contactId_fkey FOREIGN KEY (contactId) REFERENCES Contact (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT Conversation_agentId_fkey FOREIGN KEY (agentId) REFERENCES User (id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS Message (
  id TEXT PRIMARY KEY NOT NULL,
  conversationId TEXT NOT NULL,
  direction TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  mediaUrl TEXT,
  mediaId TEXT,
  fileName TEXT,
  mimeType TEXT,
  templateName TEXT,
  templateLanguage TEXT,
  templateVariables TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  providerMessageId TEXT,
  readAt DATETIME,
  senderType TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT Message_conversationId_fkey FOREIGN KEY (conversationId) REFERENCES Conversation (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS LeadAssignmentSetting (
  id TEXT PRIMARY KEY NOT NULL,
  companyId TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL DEFAULT 'CLAIM_FIRST',
  onlineOnly BOOLEAN NOT NULL DEFAULT true,
  maxOpenPerAttendant INTEGER,
  allowAttendantClaim BOOLEAN NOT NULL DEFAULT true,
  redistributeWhenOffline BOOLEAN NOT NULL DEFAULT false,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT LeadAssignmentSetting_companyId_fkey FOREIGN KEY (companyId) REFERENCES Company (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS LeadAssignmentHistory (
  id TEXT PRIMARY KEY NOT NULL,
  companyId TEXT NOT NULL,
  conversationId TEXT NOT NULL,
  assignedToUserId TEXT,
  assignedByUserId TEXT,
  mode TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'ASSIGNED',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT LeadAssignmentHistory_companyId_fkey FOREIGN KEY (companyId) REFERENCES Company (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT LeadAssignmentHistory_conversationId_fkey FOREIGN KEY (conversationId) REFERENCES Conversation (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT LeadAssignmentHistory_assignedToUserId_fkey FOREIGN KEY (assignedToUserId) REFERENCES User (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT LeadAssignmentHistory_assignedByUserId_fkey FOREIGN KEY (assignedByUserId) REFERENCES User (id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS LeadAssignmentHistory_companyId_idx ON LeadAssignmentHistory(companyId);
CREATE INDEX IF NOT EXISTS LeadAssignmentHistory_conversationId_idx ON LeadAssignmentHistory(conversationId);
CREATE INDEX IF NOT EXISTS LeadAssignmentHistory_assignedToUserId_idx ON LeadAssignmentHistory(assignedToUserId);
CREATE INDEX IF NOT EXISTS LeadAssignmentHistory_assignedByUserId_idx ON LeadAssignmentHistory(assignedByUserId);

CREATE TABLE IF NOT EXISTS Notification (
  id TEXT PRIMARY KEY NOT NULL,
  companyId TEXT NOT NULL,
  userId TEXT,
  conversationId TEXT NOT NULL,
  contactId TEXT,
  channelId TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'NEW_INBOUND_MESSAGE',
  channelLabel TEXT,
  readAt DATETIME,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT Notification_companyId_fkey FOREIGN KEY (companyId) REFERENCES Company (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT Notification_userId_fkey FOREIGN KEY (userId) REFERENCES User (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT Notification_conversationId_fkey FOREIGN KEY (conversationId) REFERENCES Conversation (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT Notification_contactId_fkey FOREIGN KEY (contactId) REFERENCES Contact (id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS Notification_companyId_createdAt_idx ON Notification(companyId, createdAt);
CREATE INDEX IF NOT EXISTS Notification_companyId_readAt_idx ON Notification(companyId, readAt);
CREATE INDEX IF NOT EXISTS Notification_userId_idx ON Notification(userId);
CREATE INDEX IF NOT EXISTS Notification_conversationId_idx ON Notification(conversationId);
CREATE INDEX IF NOT EXISTS Notification_contactId_idx ON Notification(contactId);

CREATE TABLE IF NOT EXISTS ConversationTag (
  id TEXT PRIMARY KEY NOT NULL,
  companyId TEXT NOT NULL,
  conversationId TEXT NOT NULL,
  tagId TEXT NOT NULL,
  createdByUserId TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ConversationTag_companyId_fkey FOREIGN KEY (companyId) REFERENCES Company (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ConversationTag_conversationId_fkey FOREIGN KEY (conversationId) REFERENCES Conversation (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ConversationTag_tagId_fkey FOREIGN KEY (tagId) REFERENCES Tag (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ConversationTag_createdByUserId_fkey FOREIGN KEY (createdByUserId) REFERENCES User (id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ConversationTag_conversationId_tagId_key ON ConversationTag(conversationId, tagId);
CREATE INDEX IF NOT EXISTS ConversationTag_companyId_idx ON ConversationTag(companyId);
CREATE INDEX IF NOT EXISTS ConversationTag_conversationId_idx ON ConversationTag(conversationId);
CREATE INDEX IF NOT EXISTS ConversationTag_tagId_idx ON ConversationTag(tagId);
CREATE INDEX IF NOT EXISTS ConversationTag_createdByUserId_idx ON ConversationTag(createdByUserId);

CREATE TABLE IF NOT EXISTS ContactActivity (
  id TEXT PRIMARY KEY NOT NULL,
  contactId TEXT NOT NULL,
  userId TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ContactActivity_contactId_fkey FOREIGN KEY (contactId) REFERENCES Contact (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ContactActivity_userId_fkey FOREIGN KEY (userId) REFERENCES User (id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS ContactActivity_contactId_idx ON ContactActivity(contactId);
CREATE INDEX IF NOT EXISTS ContactActivity_userId_idx ON ContactActivity(userId);

CREATE TABLE IF NOT EXISTS Task (
  id TEXT PRIMARY KEY NOT NULL,
  companyId TEXT NOT NULL,
  contactId TEXT NOT NULL,
  assigneeId TEXT,
  title TEXT NOT NULL,
  note TEXT,
  dueAt DATETIME NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  completedAt DATETIME,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT Task_companyId_fkey FOREIGN KEY (companyId) REFERENCES Company (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT Task_contactId_fkey FOREIGN KEY (contactId) REFERENCES Contact (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT Task_assigneeId_fkey FOREIGN KEY (assigneeId) REFERENCES User (id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS Task_companyId_idx ON Task(companyId);
CREATE INDEX IF NOT EXISTS Task_contactId_idx ON Task(contactId);
CREATE INDEX IF NOT EXISTS Task_assigneeId_idx ON Task(assigneeId);
CREATE INDEX IF NOT EXISTS Task_dueAt_idx ON Task(dueAt);

CREATE TABLE IF NOT EXISTS Proposal (
  id TEXT PRIMARY KEY NOT NULL,
  companyId TEXT NOT NULL,
  contactId TEXT NOT NULL,
  bank TEXT NOT NULL,
  agreement TEXT NOT NULL,
  product TEXT NOT NULL,
  amount DECIMAL NOT NULL,
  commission DECIMAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT Proposal_companyId_fkey FOREIGN KEY (companyId) REFERENCES Company (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT Proposal_contactId_fkey FOREIGN KEY (contactId) REFERENCES Contact (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS CltIntegration (
  id TEXT PRIMARY KEY NOT NULL,
  companyId TEXT NOT NULL,
  bankId TEXT NOT NULL,
  bankName TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'manual',
  baseUrl TEXT,
  authType TEXT NOT NULL DEFAULT 'none',
  apiKey TEXT,
  username TEXT,
  password TEXT,
  newcorbanIdentifier TEXT,
  digitadorCode TEXT,
  certifiedAgentCpf TEXT,
  actingUf TEXT,
  smsStatus TEXT,
  smsRequestedAt DATETIME,
  status TEXT NOT NULL DEFAULT 'MANUAL',
  lastTestAt DATETIME,
  lastTestStatus TEXT,
  lastTestMessage TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT CltIntegration_companyId_fkey FOREIGN KEY (companyId) REFERENCES Company (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS CltIntegration_companyId_bankId_key ON CltIntegration(companyId, bankId);
CREATE INDEX IF NOT EXISTS CltIntegration_companyId_idx ON CltIntegration(companyId);
CREATE INDEX IF NOT EXISTS CltIntegration_status_idx ON CltIntegration(status);

CREATE TABLE IF NOT EXISTS CltSimulationLog (
  id TEXT PRIMARY KEY NOT NULL,
  companyId TEXT NOT NULL,
  userId TEXT,
  contactId TEXT,
  bankId TEXT,
  bankName TEXT,
  action TEXT NOT NULL,
  cpf TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'SUCCESS',
  message TEXT,
  inputJson TEXT,
  outputJson TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT CltSimulationLog_companyId_fkey FOREIGN KEY (companyId) REFERENCES Company (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT CltSimulationLog_userId_fkey FOREIGN KEY (userId) REFERENCES User (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT CltSimulationLog_contactId_fkey FOREIGN KEY (contactId) REFERENCES Contact (id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS CltSimulationLog_companyId_createdAt_idx ON CltSimulationLog(companyId, createdAt);
CREATE INDEX IF NOT EXISTS CltSimulationLog_userId_idx ON CltSimulationLog(userId);
CREATE INDEX IF NOT EXISTS CltSimulationLog_contactId_idx ON CltSimulationLog(contactId);
CREATE INDEX IF NOT EXISTS CltSimulationLog_bankId_idx ON CltSimulationLog(bankId);
CREATE INDEX IF NOT EXISTS CltSimulationLog_status_idx ON CltSimulationLog(status);
`);

const contactColumns = db
  .prepare("PRAGMA table_info(Contact)")
  .all()
  .map((column) => column.name);

if (!contactColumns.includes("archivedAt")) {
  db.exec("ALTER TABLE Contact ADD COLUMN archivedAt DATETIME;");
}

const channelColumns = db
  .prepare("PRAGMA table_info(Channel)")
  .all()
  .map((column) => column.name);

for (const [name, type] of [
  ["phoneNumberId", "TEXT"],
  ["wabaId", "TEXT"],
  ["displayPhone", "TEXT"],
  ["accessToken", "TEXT"],
  ["verifyToken", "TEXT"],
  ["appSecret", "TEXT"]
]) {
  if (!channelColumns.includes(name)) {
    db.exec(`ALTER TABLE Channel ADD COLUMN ${name} ${type};`);
  }
}

const tagColumns = db
  .prepare("PRAGMA table_info(Tag)")
  .all()
  .map((column) => column.name);

for (const [name, type] of [
  ["textColor", "TEXT DEFAULT '#ffffff'"],
  ["category", "TEXT"],
  ["isActive", "BOOLEAN NOT NULL DEFAULT true"],
  ["createdAt", "DATETIME"],
  ["updatedAt", "DATETIME"]
]) {
  if (!tagColumns.includes(name)) {
    db.exec(`ALTER TABLE Tag ADD COLUMN ${name} ${type};`);
  }
}

db.exec(`
UPDATE Tag SET textColor = '#ffffff' WHERE textColor IS NULL;
UPDATE Tag SET isActive = true WHERE isActive IS NULL;
UPDATE Tag SET createdAt = CURRENT_TIMESTAMP WHERE createdAt IS NULL;
UPDATE Tag SET updatedAt = CURRENT_TIMESTAMP WHERE updatedAt IS NULL;
`);

const messageColumns = db
  .prepare("PRAGMA table_info(Message)")
  .all()
  .map((column) => column.name);

for (const [name, type] of [
  ["type", "TEXT NOT NULL DEFAULT 'text'"],
  ["mediaUrl", "TEXT"],
  ["mediaId", "TEXT"],
  ["fileName", "TEXT"],
  ["mimeType", "TEXT"],
  ["templateName", "TEXT"],
  ["templateLanguage", "TEXT"],
  ["templateVariables", "TEXT"],
  ["status", "TEXT NOT NULL DEFAULT 'sent'"],
  ["providerMessageId", "TEXT"],
  ["readAt", "DATETIME"],
  ["senderType", "TEXT"]
]) {
  if (!messageColumns.includes(name)) {
    db.exec(`ALTER TABLE Message ADD COLUMN ${name} ${type};`);
  }
}

const conversationColumns = db
  .prepare("PRAGMA table_info(Conversation)")
  .all()
  .map((column) => column.name);

for (const [name, type] of [
  ["unreadCount", "INTEGER NOT NULL DEFAULT 0"],
  ["lastMessageAt", "DATETIME"],
  ["lastMessagePreview", "TEXT"],
  ["lastInboundMessageAt", "DATETIME"],
  ["lastReadAt", "DATETIME"]
]) {
  if (!conversationColumns.includes(name)) {
    db.exec(`ALTER TABLE Conversation ADD COLUMN ${name} ${type};`);
  }
}

db.exec("CREATE INDEX IF NOT EXISTS Message_providerMessageId_idx ON Message(providerMessageId);");

db.close();

console.log(`SQLite pronto em ${dbPath}`);
