import type { CryptoService } from '../../common/crypto.service';
import { graphApi, type InstagramLoginMethod } from '../../common/meta-graph';

/** A connected Instagram account as a Graph call needs it: the id it names, the token, and the host. */
export interface IgAccount {
  igAccountId: string;
  token: string;
  /** graph.instagram.com for an Instagram Login connection, graph.facebook.com for Unified Login. */
  api: string;
}

/** The account behind a connection; null when it has no account id or token (disconnected). */
export function igAccountOf(
  connection: {
    externalAccountId: string | null;
    accessTokenEncrypted: string | null;
    loginMethod?: InstagramLoginMethod | null;
  },
  crypto: Pick<CryptoService, 'decrypt'>,
): IgAccount | null {
  if (!connection.externalAccountId || !connection.accessTokenEncrypted) return null;
  return {
    igAccountId: connection.externalAccountId,
    token: crypto.decrypt(connection.accessTokenEncrypted),
    api: graphApi(connection.loginMethod),
  };
}
