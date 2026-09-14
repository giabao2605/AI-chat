import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const MEMORY_TYPES = new Set(['semantic', 'episodic', 'belief', 'relationship', 'private', 'procedural']);

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function cleanText(value, maxLength = 8000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeText(value) {
  return cleanText(value, 12000)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeSearchText(value) {
  return cleanText(value, 12000)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchTokens(value) {
  return new Set(normalizeSearchText(value)
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .slice(0, 300));
}

function lexicalSimilarity(query, content) {
  const left = searchTokens(query);
  const right = searchTokens(content);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / Math.sqrt(left.size * right.size);
}

function safeJsonParse(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function toRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    agentId: row.agent_id,
    namespace: row.namespace,
    type: row.memory_type,
    key: row.memory_key || '',
    content: row.content,
    importance: Number(row.importance),
    confidence: Number(row.confidence),
    visibility: row.visibility,
    sourceType: row.source_type,
    sourceId: row.source_id || '',
    runId: row.run_id || '',
    supersedesId: row.supersedes_id || '',
    metadata: safeJsonParse(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at || '',
    accessCount: Number(row.access_count || 0),
    active: Boolean(row.active),
  };
}

function placeholders(count) {
  return new Array(Math.max(1, count)).fill('?').join(', ');
}

export class SqliteMemoryStore {
  constructor({ path = './data/agent-memory.sqlite' } = {}) {
    this.path = path === ':memory:' ? ':memory:' : resolve(path);
    if (this.path !== ':memory:') mkdirSync(dirname(this.path), { recursive: true });
    this.db = new DatabaseSync(this.path);
    this.db.exec('PRAGMA foreign_keys = ON;');
    if (this.path !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_memories (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        memory_key TEXT,
        content TEXT NOT NULL,
        normalized_content TEXT NOT NULL,
        search_content TEXT NOT NULL DEFAULT '',
        importance REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 0.5,
        visibility TEXT NOT NULL DEFAULT 'private',
        source_type TEXT NOT NULL DEFAULT 'conversation',
        source_id TEXT,
        run_id TEXT,
        supersedes_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_accessed_at TEXT,
        access_count INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_agent_memories_lookup
        ON agent_memories(agent_id, namespace, active, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_memories_importance
        ON agent_memories(agent_id, namespace, active, importance DESC, confidence DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_memories_type
        ON agent_memories(agent_id, namespace, memory_type, active);
      CREATE INDEX IF NOT EXISTS idx_agent_memories_key
        ON agent_memories(agent_id, namespace, memory_type, memory_key, active);
      CREATE INDEX IF NOT EXISTS idx_agent_memories_source
        ON agent_memories(source_type, source_id);
    `);

    // Forward-compatible migration for databases created by an earlier memory prototype.
    const columns = new Set(this.db.prepare('PRAGMA table_info(agent_memories)').all().map((row) => row.name));
    if (!columns.has('search_content')) {
      this.db.exec("ALTER TABLE agent_memories ADD COLUMN search_content TEXT NOT NULL DEFAULT '';");
    }
  }

  close() {
    this.db?.close?.();
  }

  upsert(memory = {}) {
    const agentId = cleanText(memory.agentId, 80).toLowerCase();
    const namespace = cleanText(memory.namespace || 'agent', 180);
    const type = cleanText(memory.type || 'episodic', 40).toLowerCase();
    const content = cleanText(memory.content, Number(memory.maxContentLength) || 8000);
    const normalizedContent = normalizeText(content);
    const searchContent = normalizeSearchText(`${content} ${memory.key || ''}`);
    const key = cleanText(memory.key, 240).toLowerCase() || null;
    if (!agentId) throw new Error('Memory thiếu agentId.');
    if (!namespace) throw new Error('Memory thiếu namespace.');
    if (!MEMORY_TYPES.has(type)) throw new Error(`Memory type không hợp lệ: ${type}`);
    if (!content || !normalizedContent) throw new Error('Memory content trống.');

    const now = new Date().toISOString();
    const importance = clamp(memory.importance, 0, 1, 0.5);
    const confidence = clamp(memory.confidence, 0, 1, 0.5);
    const visibility = cleanText(memory.visibility || 'private', 40) || 'private';
    const sourceType = cleanText(memory.sourceType || 'conversation', 80) || 'conversation';
    const sourceId = cleanText(memory.sourceId, 240) || null;
    const runId = cleanText(memory.runId, 240) || null;
    const metadata = memory.metadata && typeof memory.metadata === 'object' ? memory.metadata : {};

    let existing = null;
    if (key) {
      existing = this.db.prepare(`
        SELECT * FROM agent_memories
        WHERE agent_id = ? AND namespace = ? AND memory_type = ? AND memory_key = ? AND active = 1
        ORDER BY updated_at DESC LIMIT 1
      `).get(agentId, namespace, type, key);
    }
    if (!existing) {
      existing = this.db.prepare(`
        SELECT * FROM agent_memories
        WHERE agent_id = ? AND namespace = ? AND memory_type = ? AND normalized_content = ? AND active = 1
        ORDER BY updated_at DESC LIMIT 1
      `).get(agentId, namespace, type, normalizedContent);
    }

    if (existing && existing.normalized_content === normalizedContent) {
      const oldMetadata = safeJsonParse(existing.metadata_json, {});
      this.db.prepare(`
        UPDATE agent_memories
        SET content = ?, search_content = ?, importance = ?, confidence = ?, visibility = ?, source_type = ?, source_id = ?,
            run_id = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        content,
        searchContent,
        Math.max(Number(existing.importance || 0), importance),
        confidence,
        visibility,
        sourceType,
        sourceId,
        runId,
        JSON.stringify({ ...oldMetadata, ...metadata }),
        now,
        existing.id,
      );
      return toRecord(this.db.prepare('SELECT * FROM agent_memories WHERE id = ?').get(existing.id));
    }

    let supersedesId = null;
    if (existing && key) {
      supersedesId = existing.id;
      this.db.prepare('UPDATE agent_memories SET active = 0, updated_at = ? WHERE id = ?').run(now, existing.id);
    }

    const id = cleanText(memory.id, 240) || randomUUID();
    this.db.prepare(`
      INSERT INTO agent_memories (
        id, agent_id, namespace, memory_type, memory_key, content, normalized_content, search_content,
        importance, confidence, visibility, source_type, source_id, run_id, supersedes_id,
        metadata_json, created_at, updated_at, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      id,
      agentId,
      namespace,
      type,
      key,
      content,
      normalizedContent,
      searchContent,
      importance,
      confidence,
      visibility,
      sourceType,
      sourceId,
      runId,
      supersedesId,
      JSON.stringify(metadata),
      now,
      now,
    );
    return toRecord(this.db.prepare('SELECT * FROM agent_memories WHERE id = ?').get(id));
  }

  retrieve(agentId, {
    namespaces = ['agent'],
    query = '',
    limit = 8,
    candidateLimit = 180,
    types = null,
    excludePrivateRunId = '',
  } = {}) {
    const cleanAgentId = cleanText(agentId, 80).toLowerCase();
    const cleanNamespaces = [...new Set((Array.isArray(namespaces) ? namespaces : [namespaces])
      .map((item) => cleanText(item, 180)).filter(Boolean))];
    if (!cleanAgentId || !cleanNamespaces.length) return [];

    const cleanTypes = Array.isArray(types)
      ? types.map((item) => cleanText(item, 40).toLowerCase()).filter((item) => MEMORY_TYPES.has(item))
      : [];
    const cleanExcludedRun = cleanText(excludePrivateRunId, 240);
    const baseParams = [cleanAgentId, ...cleanNamespaces];
    let where = `agent_id = ? AND namespace IN (${placeholders(cleanNamespaces.length)}) AND active = 1`;
    if (cleanTypes.length) {
      where += ` AND memory_type IN (${placeholders(cleanTypes.length)})`;
      baseParams.push(...cleanTypes);
    }
    if (cleanExcludedRun) {
      where += " AND NOT (memory_type = 'private' AND run_id = ?)";
      baseParams.push(cleanExcludedRun);
    }

    const perPool = Math.max(30, Math.min(500, Math.floor(Number(candidateLimit) || 180)));
    const candidates = new Map();
    const addRows = (rows) => {
      for (const row of rows) candidates.set(row.id, row);
    };
    const selectPool = (orderBy, poolLimit = perPool) => this.db.prepare(
      `SELECT * FROM agent_memories WHERE ${where} ORDER BY ${orderBy} LIMIT ?`,
    ).all(...baseParams, poolLimit);

    addRows(selectPool('updated_at DESC'));
    addRows(selectPool('importance DESC, confidence DESC, updated_at DESC', Math.max(30, Math.floor(perPool * 0.65))));
    addRows(selectPool('access_count DESC, last_accessed_at DESC, updated_at DESC', Math.max(20, Math.floor(perPool * 0.35))));

    const queryTokens = [...searchTokens(query)]
      .filter((token) => token.length >= 3)
      .sort((a, b) => b.length - a.length)
      .slice(0, 8);
    if (queryTokens.length) {
      const clauses = queryTokens.map(() => 'search_content LIKE ?').join(' OR ');
      const params = [...baseParams, ...queryTokens.map((token) => `%${token}%`), perPool];
      const rows = this.db.prepare(
        `SELECT * FROM agent_memories WHERE ${where} AND (${clauses}) ORDER BY importance DESC, updated_at DESC LIMIT ?`,
      ).all(...params);
      addRows(rows);
    }

    const now = Date.now();
    const scored = [...candidates.values()].map((row) => {
      const updated = Date.parse(row.updated_at || row.created_at || '') || now;
      const ageDays = Math.max(0, (now - updated) / 86_400_000);
      const recency = Math.exp(-ageDays / 120);
      const access = Math.min(1, Math.log1p(Number(row.access_count || 0)) / Math.log(12));
      const relevance = lexicalSimilarity(query, `${row.content} ${row.memory_key || ''}`);
      const typeBonus = row.memory_type === 'relationship' ? 0.025 : row.memory_type === 'procedural' ? 0.02 : 0;
      let score = relevance * 0.62
        + clamp(row.importance, 0, 1, 0.5) * 0.17
        + clamp(row.confidence, 0, 1, 0.5) * 0.07
        + recency * 0.08
        + access * 0.04
        + typeBonus;
      if (queryTokens.length && relevance === 0) score *= 0.55;
      return { row, score, relevance };
    }).sort((a, b) => b.score - a.score || b.relevance - a.relevance)
      .slice(0, Math.max(1, Math.min(50, Math.floor(Number(limit) || 8))));

    const touchedAt = new Date().toISOString();
    const touch = this.db.prepare('UPDATE agent_memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?');
    for (const item of scored) touch.run(touchedAt, item.row.id);
    return scored.map(({ row, score }) => ({ ...toRecord(row), score }));
  }

  list(agentId, { namespaces = ['agent'], limit = 100, includeInactive = false, type = '' } = {}) {
    const cleanAgentId = cleanText(agentId, 80).toLowerCase();
    const cleanNamespaces = [...new Set((Array.isArray(namespaces) ? namespaces : [namespaces])
      .map((item) => cleanText(item, 180)).filter(Boolean))];
    if (!cleanAgentId || !cleanNamespaces.length) return [];
    const params = [cleanAgentId, ...cleanNamespaces];
    let sql = `SELECT * FROM agent_memories WHERE agent_id = ? AND namespace IN (${placeholders(cleanNamespaces.length)})`;
    if (!includeInactive) sql += ' AND active = 1';
    const cleanType = cleanText(type, 40).toLowerCase();
    if (MEMORY_TYPES.has(cleanType)) {
      sql += ' AND memory_type = ?';
      params.push(cleanType);
    }
    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(Math.max(1, Math.min(1000, Math.floor(Number(limit) || 100))));
    return this.db.prepare(sql).all(...params).map(toRecord);
  }

  stats(agentId, { namespaces = ['agent'] } = {}) {
    const cleanAgentId = cleanText(agentId, 80).toLowerCase();
    const cleanNamespaces = [...new Set((Array.isArray(namespaces) ? namespaces : [namespaces])
      .map((item) => cleanText(item, 180)).filter(Boolean))];
    if (!cleanAgentId || !cleanNamespaces.length) return { total: 0, byType: {} };
    const rows = this.db.prepare(`
      SELECT memory_type, COUNT(*) AS count
      FROM agent_memories
      WHERE agent_id = ? AND namespace IN (${placeholders(cleanNamespaces.length)}) AND active = 1
      GROUP BY memory_type
    `).all(cleanAgentId, ...cleanNamespaces);
    const byType = Object.fromEntries(rows.map((row) => [row.memory_type, Number(row.count || 0)]));
    return { total: Object.values(byType).reduce((sum, value) => sum + value, 0), byType };
  }

  clear(agentId, { namespaces = ['agent'], type = '' } = {}) {
    const cleanAgentId = cleanText(agentId, 80).toLowerCase();
    const cleanNamespaces = [...new Set((Array.isArray(namespaces) ? namespaces : [namespaces])
      .map((item) => cleanText(item, 180)).filter(Boolean))];
    if (!cleanAgentId || !cleanNamespaces.length) return 0;
    const params = [cleanAgentId, ...cleanNamespaces];
    let sql = `DELETE FROM agent_memories WHERE agent_id = ? AND namespace IN (${placeholders(cleanNamespaces.length)})`;
    const cleanType = cleanText(type, 40).toLowerCase();
    if (MEMORY_TYPES.has(cleanType)) {
      sql += ' AND memory_type = ?';
      params.push(cleanType);
    }
    const result = this.db.prepare(sql).run(...params);
    return Number(result.changes || 0);
  }
}
