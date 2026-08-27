/**
 * Où frapper, selon la nature du serveur.
 *
 * Les deux serveurs parlent le même protocole depuis la v2 — mêmes messages,
 * même régime de jetons, même contrat de dépôt — mais ils ne l'exposent pas aux
 * mêmes URL, et ils ne le peuvent pas : `play` est bâti autour d'une SESSION
 * éphémère (`/api/sessions/:id/…`), `kiosk-hub` autour d'un registre durable où
 * la borne emprunte les routes du participant (`/api/v1/…`). Aligner les deux
 * casserait l'un ou l'autre.
 *
 * Ce module est donc la traduction, et le seul endroit où elle vit. Avant lui,
 * la borne codait la forme `play` en dur dans quatre fichiers : elle ne pouvait
 * matériellement pas s'enrôler ailleurs, quoi qu'annonce le protocole.
 *
 * La borne apprend la nature du serveur dans le QR d'enrôlement
 * (`DeviceConfigQr.serverKind`) et la retient avec le reste de sa
 * configuration.
 */
import type { ServerKind } from './enrollment';

/** Ce dont la borne a besoin pour joindre son serveur, une fois enrôlée. */
export interface DeviceEndpoints {
  /** Socket de régie — consignes de la console, accusés de réception. */
  websocket: string;
  /**
   * `POST` — qui vient de scanner ce badge ?
   *
   * Appelée en régime `resolve`, et en régime `signed` seulement pour
   * confirmer qu'un porteur de badge valide n'a pas été écarté depuis.
   */
  resolveBadge: string;
  /**
   * `GET` — les NOMS des participants, pour la régie locale de secours.
   *
   * `null` quand le serveur n'expose pas d'annuaire : la borne masque alors le
   * choix « réservé à… » de son écran de secours au lieu d'afficher une liste
   * vide qu'aucun réessai ne remplira.
   */
  roster: string | null;
  video: VideoEndpoints;
}

/**
 * Dépôt d'une vidéo, en trois temps : réserver, faire signer, annoncer.
 *
 * Les deux serveurs suivent la même chorégraphie, à un détail près qui se voit
 * ici : `play` réserve et signe d'un seul appel (`create === ticket`), là où
 * `kiosk-hub` sépare les deux — il inscrit d'abord la vidéo en base, puis
 * refait un ticket frais à chaque essai, parce qu'un ticket de stockage
 * expire et qu'une borne qui reprend une heure plus tard buterait sinon sur
 * une URL périmée au message illisible.
 *
 * `create` et `ticket` prennent l'identifiant rendu par l'étape précédente ;
 * `oneShot` dit à l'appelant s'il doit sauter la seconde.
 */
export interface VideoEndpoints {
  /** `POST` — réserve la vidéo et rend son identifiant serveur. */
  create: string;
  /** `true` : `create` rend déjà le ticket, il n'y a pas de second appel. */
  oneShot: boolean;
  /** `POST` — ticket de dépôt pour la vidéo réservée. */
  ticket(entryId: string): string;
  /** `POST` — les octets sont sur le stockage. */
  uploaded(entryId: string): string;
  /** `GET` — où en est l'encodage. */
  status(entryId: string): string;
}

function trimSlash(url: string): string {
  return String(url || '').trim().replace(/\/+$/, '');
}

/** `https://host` -> `wss://host` — le schéma seul change. */
function toWebsocket(base: string): string {
  return base.replace(/^http/i, 'ws');
}

/**
 * URL d'enrôlement.
 *
 * À part, et non dans `deviceEndpoints`, parce qu'elle se calcule AVANT que la
 * borne ait quoi que ce soit : au moment du scan, elle n'a ni jeton ni
 * configuration enregistrée, seulement le contenu du QR.
 */
export function enrollEndpoint(kind: ServerKind, serverUrl: string, target?: string | null): string {
  const base = trimSlash(serverUrl);
  if (kind === 'hub') return `${base}/api/v1/devices/enroll`;
  // `play` désigne la session dans le CHEMIN : ses sessions sont éphémères et
  // la route entière n'existe que tant que la session existe.
  return `${base}/api/sessions/${encodeURIComponent(String(target || ''))}/kiosks/enroll`;
}

/**
 * Corps de l'appel d'enrôlement.
 *
 * La cible voyage dans le chemin chez `play` et dans le corps chez `kiosk-hub`,
 * où elle est facultative — le mot de passe peut suffire à désigner la
 * campagne. L'envoyer aux deux endroits serait sans effet chez `play` mais
 * ferait mentir la lecture du code ; on la place donc là où elle sert.
 */
export function enrollBody(
  kind: ServerKind,
  input: { password: string; target?: string | null; name?: string; deviceId?: string },
): Record<string, unknown> {
  const body: Record<string, unknown> = { password: input.password };
  if (input.name) body.name = input.name;
  if (input.deviceId) body.deviceId = input.deviceId;
  if (kind === 'hub' && input.target) body.target = input.target;
  return body;
}

/**
 * Toutes les URL de fonctionnement d'une borne enrôlée.
 *
 * @param target identifiant de session (`play`) ou de campagne (`hub`). Chez
 *   `hub` il n'entre dans aucune URL — la campagne est déduite du jeton de la
 *   borne — mais le paramètre reste commun pour que l'appelant n'ait pas à
 *   savoir lequel des deux serveurs il configure.
 */
export function deviceEndpoints(
  kind: ServerKind,
  { serverUrl, target }: { serverUrl: string; target?: string | null },
): DeviceEndpoints {
  const base = trimSlash(serverUrl);

  if (kind === 'hub') {
    const recordings = `${base}/api/v1/recordings`;
    return {
      websocket: `${toWebsocket(base)}/ws`,
      resolveBadge: `${base}/api/v1/devices/resolve-badge`,
      // Le registre durable ne rend pas d'annuaire à une borne, et c'est
      // délibéré : ses participants existent avant l'événement, en nombre, et
      // une borne n'a aucune raison de détenir la liste des inscrits. En régime
      // `signed` elle n'en a pas besoin — le badge se vérifie hors ligne.
      roster: null,
      video: {
        create: recordings,
        oneShot: false,
        ticket: (id) => `${recordings}/${encodeURIComponent(id)}/ticket`,
        uploaded: (id) => `${recordings}/${encodeURIComponent(id)}/uploaded`,
        status: (id) => `${recordings}/${encodeURIComponent(id)}`,
      },
    };
  }

  const session = `${base}/api/sessions/${encodeURIComponent(String(target || ''))}`;
  const videos = `${session}/kiosk/videos`;
  return {
    websocket: `${toWebsocket(base)}/api/ws`,
    resolveBadge: `${session}/devices/resolve-badge`,
    roster: `${session}/devices/roster`,
    video: {
      create: `${videos}/sign`,
      oneShot: true,
      ticket: (id) => `${videos}/${encodeURIComponent(id)}/ticket`,
      uploaded: (id) => `${videos}/${encodeURIComponent(id)}/uploaded`,
      status: (id) => `${videos}/${encodeURIComponent(id)}`,
    },
  };
}
