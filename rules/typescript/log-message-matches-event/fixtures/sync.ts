import type { Logger } from "./logger";
import type { UserRepo, User } from "./repo";
import type { Directory } from "./directory";
import type { Cache } from "./cache";

export class UserSync {
  constructor(
    private readonly repo: UserRepo,
    private readonly directory: Directory,
    private readonly cache: Cache<User>,
    private readonly logger: Logger,
  ) {}

  async syncOne(id: string): Promise<User> {
    this.logger.info("syncing user", { id });
    const remote = await this.directory.fetchUser(id);
    const user = toUser(remote);
    this.logger.info("user saved", { id });
    await this.repo.save(user);
    this.cache.set(id, user);
    return user;
  }

  async syncAll(ids: string[]): Promise<number> {
    let ok = 0;
    for (const id of ids) {
      try {
        this.logger.debug("saving user", { id });
        const remote = await this.directory.fetchUser(id);
        await this.repo.save(toUser(remote));
        ok += 1;
      } catch (err) {
        this.logger.warn("user synced", { id, err });
      } finally {
        this.logger.debug("sync finished", { id, ok });
      }
    }
    this.logger.info("done", { ok, total: ids.length });
    return ok;
  }

  peek(id: string): User | undefined {
    const cached = this.cache.get(id);
    if (cached) {
      this.logger.debug("cache hit", { id });
    }
    return cached;
  }

  async load(id: string): Promise<User> {
    const cached = this.cache.get(id);
    if (cached) {
      return cached;
    }
    this.logger.debug("cache hit", { userId: id });
    const user = await this.repo.find(id);
    if (!user) {
      throw new Error(`user ${id} not found`);
    }
    this.cache.set(id, user);
    return user;
  }

  async loadProfile(id: string): Promise<User | null> {
    const cached = this.cache.get(id);
    if (cached) {
      return cached;
    }
    this.logger.debug("cache miss, reading profile from repo", { id });
    const user = await this.repo.find(id);
    if (user) {
      this.cache.set(id, user);
    }
    return user;
  }

  async fetchWithRetry(id: string, attempts = 3): Promise<User> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return toUser(await this.directory.fetchUser(id));
      } catch (err) {
        lastErr = err;
        this.logger.info("retrying directory fetch", { id, attempt });
        await sleep(attempt * 200);
      }
    }
    throw lastErr;
  }

  async fetchOnce(id: string): Promise<User> {
    try {
      return toUser(await this.directory.fetchUser(id));
    } catch (err) {
      this.logger.warn("directory fetch failed, retrying", { id, err });
      throw err;
    }
  }

  async purgeInactive(days: number): Promise<number> {
    const stale = await this.repo.findInactiveSince(days);
    const result = await this.repo.deleteMany(stale.map((u) => u.id));
    this.logger.info(`deleted ${stale.length} inactive users`, { days });
    return result.deletedCount;
  }

  async archiveSessions(days: number): Promise<number> {
    const result = await this.repo.archiveSessionsOlderThan(days);
    this.logger.info(`archived ${result.archivedCount} sessions older than ${days}d`);
    return result.archivedCount;
  }

  async fetchPage(source: string, page: number): Promise<User[]> {
    const users = (await this.directory.listUsers(page)).map(toUser);
    this.logger.debug(`fetched ${users.length} users from ${source} (page ${page})`);
    return users;
  }
}

export function toUser(remote: { id: string; email: string; name?: string }): User {
  return { id: remote.id, email: remote.email.toLowerCase(), name: remote.name ?? "" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
