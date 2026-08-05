/**
 * Enveloppes WebSocket échangées entre une borne et le serveur de jeu.
 *
 * Ces noms sont ceux qui circulent depuis l'origine sur les bornes installées.
 * Les renommer n'apporterait rien et couperait tout parc déjà posé : une borne
 * en salle ne se met pas à jour le soir de l'événement.
 *
 * Sens de circulation :
 *
 *   borne ──▶ serveur   join, state
 *   serveur ──▶ borne   welcome, error, command
 */
export const KIOSK_EVENTS = {
  /** Première trame de la borne : elle s'annonce et présente son jeton. */
  JOIN: 'kiosk_join',
  /** Rattachement accepté. Porte l'identité retenue par le serveur. */
  WELCOME: 'kiosk_welcome',
  /** Refus ou incident. `fatal` = inutile d'insister à la même cadence. */
  ERROR: 'kiosk_error',
  /** Consigne de régie poussée vers la borne. Charge utile = `KioskCommand`. */
  COMMAND: 'kiosk_command',
  /** Remontée d'état de la borne, groupée puis envoyée au fil de la soirée. */
  STATE: 'kiosk_state',
} as const;

export type KioskEvent = (typeof KIOSK_EVENTS)[keyof typeof KIOSK_EVENTS];

/** Trame envoyée par la borne à l'ouverture de la socket. */
export interface KioskJoinPayload {
  /** Session visée. Sans elle, le serveur ne sait pas à quoi rattacher la borne. */
  gameId: string;
  /**
   * Jeton admin de la session. Exigé sauf si le serveur tourne en `KIOSK_AUTH=open`.
   * Une borne rattachée reçoit les consignes de régie : c'est un poste de confiance.
   */
  adminToken?: string;
  /**
   * Identité stable de la borne, tirée une fois puis persistée. Sans elle,
   * chaque redémarrage créerait une ligne de plus dans la console et
   * l'organisateur verrait s'accumuler des fantômes de la même borne.
   */
  kioskId?: string;
  /** Nom lisible affiché en console (« Salon », « Cuisine »…). */
  name?: string;
  /** Version applicative de la borne, pour repérer un parc hétérogène. */
  version?: string;
  /** État initial, pour que la console n'affiche pas une ligne vide en attendant. */
  state?: unknown;
}

export interface KioskWelcomePayload {
  kioskId: string;
  gameId: string;
}

export interface KioskErrorPayload {
  message: string;
  /** `true` : la cause ne se répare pas en réessayant (jeton refusé, session inconnue). */
  fatal?: boolean;
}
