/**
 * Enrôlement d'une borne par QR code.
 *
 * Le problème résolu : brancher une borne demandait de saisir au clavier une
 * URL, un identifiant et un jeton de 64 caractères — sur une machine posée
 * debout dans une salle, souvent sans clavier confortable, le soir de
 * l'événement. Le QR fait le même travail en une seconde.
 *
 * ## Ce que le QR transporte, et ce qu'il ne transporte pas
 *
 * Il porte un **mot de passe d'enrôlement**, jamais un jeton. La borne
 * l'échange contre le sien auprès du serveur.
 *
 * La différence compte : un QR s'affiche sur un écran, se photographie de
 * loin, se retrouve dans la pellicule de quelqu'un. Un mot de passe volé
 * rattache une borne de plus — et cette borne-là, on la voit dans la console
 * et on la révoque. Un jeton volé, lui, pilote directement.
 *
 * ## Format
 *
 * ```json
 * {"v":2,"t":"kiosk-config","u":"https://kiosk.exemple.fr","p":"<mot de passe>","g":"<cible|absent>"}
 * ```
 */

/** Marqueur de type. Ce qui distingue ce QR d'un badge de participant. */
export const DEVICE_CONFIG_QR_TYPE = 'kiosk-config';

/** Version du format. */
export const DEVICE_CONFIG_QR_VERSION = 2;

export interface DeviceConfigQr {
  /** URL du serveur, sans barre oblique finale. */
  serverUrl: string;
  /** Mot de passe d'enrôlement, à échanger contre le jeton de la borne. */
  password: string;
  /**
   * Cible du rattachement — campagne ou session — quand le serveur en a
   * plusieurs et ne peut pas la déduire du seul mot de passe.
   *
   * Facultatif, et c'est délibéré. Un registre durable a peu de campagnes, aux
   * mots de passe distincts : il résout sans cible et l'opérateur a un QR de
   * moins à ne pas confondre. Un serveur de soirées crée des sessions à la
   * chaîne, dont les mots de passe peuvent se répéter d'un soir à l'autre :
   * il renseigne la cible, sans quoi une borne rejoindrait la session de la
   * semaine dernière.
   */
  target?: string | null;
}

interface RawDeviceConfigQr {
  v: number;
  t: string;
  u: string;
  p: string;
  g?: string;
}

/** QR de configuration d'une version que cette borne ne sait pas lire. */
export class DeviceConfigQrVersionError extends Error {
  constructor(readonly version: number) {
    super(
      `QR de configuration en version ${version} — cette borne lit la version ${DEVICE_CONFIG_QR_VERSION}.`,
    );
    this.name = 'DeviceConfigQrVersionError';
  }
}

/** Encode la charge utile à mettre dans le QR. */
export function encodeDeviceConfigQr(input: DeviceConfigQr): string {
  const payload: RawDeviceConfigQr = {
    v: DEVICE_CONFIG_QR_VERSION,
    t: DEVICE_CONFIG_QR_TYPE,
    u: String(input.serverUrl || '').trim().replace(/\/+$/, ''),
    p: String(input.password || ''),
  };
  const target = String(input.target || '').trim();
  if (target) payload.g = target;
  return JSON.stringify(payload);
}

/**
 * Lit un QR de configuration, ou rend `null` si ce n'en est pas un.
 *
 * Ne jette que sur une version inconnue — même raison que pour les badges :
 * la borne passe ici le contenu de tout QR décodé.
 */
export function parseDeviceConfigQr(raw: unknown): DeviceConfigQr | null {
  const value = String(raw ?? '').trim();
  if (!value.startsWith('{')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const row = parsed as Partial<RawDeviceConfigQr>;
  if (row.t !== DEVICE_CONFIG_QR_TYPE) return null;
  if (row.v !== DEVICE_CONFIG_QR_VERSION) {
    throw new DeviceConfigQrVersionError(Number(row.v) || 0);
  }

  const serverUrl = String(row.u || '').trim().replace(/\/+$/, '');
  const password = String(row.p || '');
  if (!serverUrl || !password) return null;
  if (!/^https?:\/\//i.test(serverUrl)) return null;

  const target = String(row.g || '').trim();
  return { serverUrl, password, target: target || null };
}

/** Corps de `POST /api/v1/devices/enroll`. */
export interface DeviceEnrollRequest {
  password: string;
  target?: string | null;
  /** Identité stable de la borne, pour que le serveur la reconnaisse ensuite. */
  deviceId?: string;
  /** Nom lisible proposé par la borne. */
  name?: string;
}

/** Réponse d'un enrôlement accepté. */
export interface DeviceEnrollResponse {
  deviceId: string;
  /**
   * Jeton propre à CETTE borne — c'est ce qu'elle enregistre.
   *
   * Il ne donne accès qu'à sa propre socket et à ses propres dépôts vidéo.
   * Il ne permet ni de piloter les autres bornes, ni de lire l'annuaire.
   */
  deviceToken: string;
  /** Libellé de la campagne ou de la session, pour l'afficher en confirmation. */
  contextLabel?: string;
}

/** Corps de `POST /api/v1/devices/resolve-badge` — mode `resolve` uniquement. */
export interface ResolveBadgeRequest {
  code: string;
}

export interface ResolveBadgeResponse {
  participantId: string;
  displayName: string;
  /** `false` : connu, mais pas autorisé sur cette borne (mode ciblé, liste). */
  allowed: boolean;
  /** Motif à afficher quand `allowed` est faux. */
  reason?: string;
}
