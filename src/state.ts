/**
 * État remonté par une borne (`kiosk_state`).
 *
 * C'est ce que la console vidéo affiche pour chaque ligne de borne. Le type est
 * volontairement tolérant : une borne d'une version antérieure remonte un état
 * incomplet, et la console doit continuer de l'afficher plutôt que de la
 * masquer — une borne qui disparaît de l'écran est bien pire qu'une borne dont
 * une case reste vide.
 */
import type { KioskMode, KioskPlayerRef } from './commands';

/** Écrans possibles d'une borne. */
export type KioskScreen = 'idle' | 'question' | 'recording' | 'thanks' | 'closed' | string;

export interface KioskQuestionRow {
  id: string;
  text: string;
  category?: string | null;
  enabled?: boolean;
  /**
   * Question posée par la borne sans qu'aucune playlist Streamlike ne l'attende.
   * La console la signale : les vidéos qui en découlent n'auront pas de rangement.
   */
  local?: boolean;
  duration?: number | null;
  usedCount?: number;
}

export interface KioskUploadJob {
  id: string;
  pseudo?: string;
  fileName?: string;
  /** `local_only` = enregistrée mais pas destinée à partir (envoi désactivé). */
  status: 'pending' | 'preparing' | 'uploading' | 'encoding' | 'done' | 'failed' | 'local_only' | string;
  attempts?: number;
  error?: string | null;
  mediaId?: string | null;
  permalink?: string | null;
  encodingStatus?: string | null;
  playlistIds?: string[];
  bytes?: number;
  createdAt?: number;
}

export interface KioskUploadsSnapshot {
  enabled: boolean;
  jobs: KioskUploadJob[];
}

export interface KioskState {
  screen: KioskScreen;
  mode: KioskMode;
  target?: KioskPlayerRef | null;
  allowed?: KioskPlayerRef[] | null;
  welcome?: { title?: string; subtitle?: string } | null;
  category?: string | null;
  categories?: string[];
  sequence?: string[];
  maxDuration?: number;
  forcedQuestion?: string | null;
  current?: unknown;
  notice?: unknown;
  entries?: unknown[];
  questions?: KioskQuestionRow[];
  uploads?: KioskUploadsSnapshot;
  recordingsDir?: string;
  uploadEnabled?: boolean;
  /** Régie web locale de la borne, plan de repli quand le serveur est injoignable. */
  localAdminUrl?: string | null;
  /** Horodatage de la borne. Sert à repérer une borne dont l'horloge dérive. */
  at?: number;
}

/** Vue console d'une borne, telle que servie par `GET /api/sessions/:id/kiosks`. */
export interface KioskSnapshot {
  id: string;
  name: string;
  online: boolean;
  version: string | null;
  connectedAt: number | null;
  /**
   * Dernier signe de vie. Une borne hors ligne reste listée un temps : au
   * moment où le wifi tombe, la faire disparaître de la console ferait croire
   * à une borne débranchée.
   */
  lastSeenAt: number | null;
  state: KioskState | null;
}
