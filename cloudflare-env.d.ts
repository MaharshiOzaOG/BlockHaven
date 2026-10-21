declare namespace Cloudflare {
  interface Env {
    ROOMS?: DurableObjectNamespace;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
