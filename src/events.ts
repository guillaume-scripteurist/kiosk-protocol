/**
 * Enveloppes WebSocket échangées entre une borne et son serveur.
 *
 * Deux serveurs les parlent — `kiosk-hub` (registre durable) et `play` (soirées
 * de jeux) — et une seule implémentation cliente les applique. C'est tout
 * l'intérêt de la v2 : la borne n'a plus à savoir à qui elle est branchée.
 *
 * Sens de circulation :
 *
 *   borne ──▶ serveur   hello, state, ack
 *   serveur ──▶ borne   ready, error, command
 */
export const DEVICE_EVENTS = {
  /** Première trame de la borne : elle s'annonce et présente son jeton. */
  HELLO: 'device_hello',
  /** Rattachement accepté. Porte le régime d'identité et les réglages. */
  READY: 'device_ready',
  /** Refus ou incident. `fatal` = inutile d'insister à la même cadence. */
  ERROR: 'device_error',
  /** Consigne de régie poussée vers la borne. */
  COMMAND: 'device_command',
  /** Remontée d'état de la borne, au fil de la soirée. */
  STATE: 'device_state',
  /**
   * Accusé de réception d'une consigne.
   *
   * La v1 n'en avait pas : la console poussait, et n'apprenait jamais si la
   * borne avait appliqué. Un organisateur qui clique « fermer la borne » et ne
   * voit rien bouger ne peut pas distinguer une socket morte d'un écran qu'il
   * ne regarde pas — et il clique à nouveau.
   */
  ACK: 'device_ack',
} as const;

export type DeviceEvent = (typeof DEVICE_EVENTS)[keyof typeof DEVICE_EVENTS];

/**
 * Régime d'identification des participants, annoncé par le serveur.
 *
 * C'est ce qui permet aux deux serveurs de parler la même langue malgré des
 * natures opposées :
 *
 *   `signed`  — le badge porte une signature que la borne vérifie SANS RÉSEAU,
 *               avec le secret reçu à l'enrôlement. Le cas d'un registre
 *               durable, où les participants existent avant l'événement.
 *
 *   `resolve` — le badge n'est pas signé ; la borne demande au serveur qui
 *               c'est. Le cas d'une soirée de jeux, où les joueurs naissent
 *               pendant la partie et où aucun secret ne pourrait les précéder.
 */
export type IdentityMode = 'signed' | 'resolve';

/** Trame envoyée par la borne à l'ouverture de la socket. */
export interface DeviceHelloPayload {
  /**
   * Jeton propre à CETTE borne, obtenu à l'enrôlement.
   *
   * En v1, toutes les bornes partageaient le jeton admin de la session : celui
   * d'une borne perdue donnait la régie de toutes les autres et l'annuaire
   * complet des joueurs. Ici, révoquer une borne ne dérange aucune autre.
   */
  deviceToken: string;
  /**
   * Identité stable de la borne, tirée une fois puis persistée. Sans elle,
   * chaque redémarrage ajouterait une ligne dans la console et l'exploitant
   * verrait s'accumuler des fantômes de la même machine.
   */
  deviceId?: string;
  /** Nom lisible affiché en console (« Salon », « Entrée »…). */
  name?: string;
  /** Version applicative de la borne, pour repérer un parc hétérogène. */
  version?: string;
  /** État initial, pour que la console n'affiche pas une ligne vide en attendant. */
  state?: unknown;
}

/** Rattachement accepté. */
export interface DeviceReadyPayload {
  deviceId: string;
  /** Nom retenu par le serveur — il peut différer de celui proposé. */
  name: string;
  identityMode: IdentityMode;
  /**
   * Secret de vérification des badges, en mode `signed` uniquement.
   *
   * Il ne circule qu'ici, sur une socket déjà authentifiée par le jeton de la
   * borne. C'est un secret de VÉRIFICATION : il ne permet pas de se faire
   * passer pour un participant auprès du serveur, seulement de reconnaître un
   * badge hors ligne.
   */
  badgeSecret?: string;
  /** Libellé de la campagne ou de la session, pour l'afficher en confirmation. */
  contextLabel?: string;
}

export interface DeviceErrorPayload {
  message: string;
  /** `true` : la cause ne se répare pas en réessayant (jeton refusé, borne révoquée). */
  fatal?: boolean;
}

/** Accusé de réception d'une consigne, renvoyé par la borne. */
export interface DeviceAckPayload {
  commandId: string;
  ok: boolean;
  /** Motif du refus, destiné à être affiché à l'organisateur. */
  error?: string;
}
