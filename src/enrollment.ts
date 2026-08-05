/**
 * Enrôlement d'une borne par QR code.
 *
 * Le problème qu'on résout : brancher une borne sur une session demandait de
 * saisir au clavier une URL, un identifiant de session (un UUID) et un jeton de
 * 64 caractères hexadécimaux — sur une machine posée debout dans une salle,
 * souvent sans clavier confortable, le soir de l'événement. Le QR fait le même
 * travail en une seconde.
 *
 * ## Ce que le QR transporte, et ce qu'il ne transporte pas
 *
 * Il porte un **mot de passe d'enrôlement**, jamais le jeton admin de la
 * session. La borne l'échange contre le jeton auprès du serveur.
 *
 * La différence compte : un QR s'affiche sur un écran, se photographie de
 * loin, se retrouve dans la pellicule de quelqu'un. Un mot de passe
 * d'enrôlement volé permet de rattacher une borne de plus ; le jeton admin,
 * lui, permet de piloter TOUTES les bornes de la session et de lire l'annuaire
 * des joueurs. Le second ne doit pas se promener sur un écran.
 *
 * ## Format
 *
 * JSON compact — le nombre de modules d'un QR croît vite avec la longueur, et
 * un QR trop dense ne se lit plus à cinquante centimètres avec une webcam.
 *
 * ```json
 * {"v":1,"t":"kiosk-config","u":"https://play.exemple.fr","g":"<uuid>","p":"<mot de passe>"}
 * ```
 */

/** Marqueur de type. Ce qui distingue ce QR d'un badge joueur. */
export const KIOSK_CONFIG_QR_TYPE = 'kiosk-config';

/** Version du format. Une borne plus ancienne refuse proprement une v2. */
export const KIOSK_CONFIG_QR_VERSION = 1;

export interface KioskConfigQr {
  /** URL du serveur de jeu, sans barre oblique finale. */
  serverUrl: string;
  /** Identifiant de la session à rejoindre. */
  gameId: string;
  /** Mot de passe d'enrôlement, à échanger contre l'`adminToken`. */
  password: string;
}

/** Charge utile telle qu'elle est encodée dans le QR (clés courtes). */
interface RawKioskConfigQr {
  v: number;
  t: string;
  u: string;
  g: string;
  p: string;
}

/** Encode la charge utile à mettre dans le QR. */
export function encodeKioskConfigQr(input: KioskConfigQr): string {
  const payload: RawKioskConfigQr = {
    v: KIOSK_CONFIG_QR_VERSION,
    t: KIOSK_CONFIG_QR_TYPE,
    u: String(input.serverUrl || '').trim().replace(/\/+$/, ''),
    g: String(input.gameId || '').trim(),
    p: String(input.password || ''),
  };
  return JSON.stringify(payload);
}

/**
 * Lit un QR de configuration, ou rend `null` si ce n'en est pas un.
 *
 * **Ne jette jamais.** La borne passe ici le contenu de TOUT QR décodé — badge
 * joueur, menu de restaurant, ticket de caisse. Une exception ici ferait
 * tomber le scan pour tout le monde.
 *
 * `null` veut dire « ce n'est pas un QR de configuration », et l'appelant
 * enchaîne sur son interprétation habituelle.
 */
export function parseKioskConfigQr(raw: unknown): KioskConfigQr | null {
  const text = String(raw ?? '').trim();
  // Écarté sans même tenter un parse : le contenu d'un QR de badge commence par
  // `http` ou par un code court, et `JSON.parse` sur chaque image scannée est un
  // coût inutile sur un thread qui décode déjà dix images par seconde.
  if (!text.startsWith('{')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const raw_ = parsed as Partial<RawKioskConfigQr>;
  if (raw_.t !== KIOSK_CONFIG_QR_TYPE) return null;
  // Une version inconnue est un refus EXPLICITE, pas un `null` : la borne doit
  // pouvoir dire « ce QR vient d'un serveur plus récent, mettez-moi à jour »
  // plutôt que d'afficher « QR non reconnu » devant quelqu'un qui vient de
  // scanner exactement le bon.
  if (raw_.v !== KIOSK_CONFIG_QR_VERSION) {
    throw new KioskConfigQrVersionError(Number(raw_.v) || 0);
  }

  const serverUrl = String(raw_.u || '').trim().replace(/\/+$/, '');
  const gameId = String(raw_.g || '').trim();
  const password = String(raw_.p || '');
  if (!serverUrl || !gameId || !password) return null;
  if (!/^https?:\/\//i.test(serverUrl)) return null;

  return { serverUrl, gameId, password };
}

/** QR de configuration d'une version que cette borne ne sait pas lire. */
export class KioskConfigQrVersionError extends Error {
  constructor(readonly version: number) {
    super(`QR de configuration en version ${version} — cette borne lit la version ${KIOSK_CONFIG_QR_VERSION}.`);
    this.name = 'KioskConfigQrVersionError';
  }
}

/** Corps de `POST /api/sessions/:gameId/kiosks/enroll`. */
export interface KioskEnrollRequest {
  password: string;
  /** Identité stable de la borne, pour que le serveur la reconnaisse ensuite. */
  kioskId?: string;
  /** Nom lisible proposé par la borne. */
  name?: string;
}

/** Réponse d'un enrôlement accepté. */
export interface KioskEnrollResponse {
  gameId: string;
  /** Jeton admin de la session — c'est ce que la borne enregistre. */
  adminToken: string;
  /** Titre de la session, pour l'afficher en confirmation. */
  title?: string;
}
