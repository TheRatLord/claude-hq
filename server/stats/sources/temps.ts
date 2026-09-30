/**
 * Temperatures (°C or null), hwmon found by name: k10temp → cpu, nvme, mt7921_phy0 → wifi, amdgpu → gpu.
 * The hwmon name map is re-scanned every 60 s; the NVMe sensor is read every 30 s only (a read can wake the drive
 * from APST and take ~10–400 ms here), Wi-Fi every 5 s.
 */
import type { Stats } from '../../../shared/protocol.ts';
import { num, hwmonByName } from './util.ts';

const WIFI = /^(mt79|iwlwifi|ath|rtw)/;
const HWMON_RESCAN_MS = 60_000;
const NVME_MS = 30_000;
const WIFI_MS = 5_000; // the mt7921 read costs ~2 ms

/** `now` in ms. */
export function createTemps(root = '', now: () => number = () => performance.now()): () => Stats['temps'] {
  let hw: Map<string, string> = new Map(), hwAt = -Infinity, nvme: number | null = null, nvmeAt = -Infinity, wifi: number | null = null, wifiAt = -Infinity;
  const t = (dir: string | null | undefined): number | null => {
    const v = dir ? num(root, `${dir}/temp1_input`) : null;
    return v === null ? null : Math.round(v / 100) / 10;
  };
  return () => {
    const at = now();
    if (at - hwAt >= HWMON_RESCAN_MS) {
      hw = hwmonByName(root);
      hwAt = at;
    }
    if (at - nvmeAt >= NVME_MS) {
      nvme = t(hw.get('nvme'));
      nvmeAt = at;
    }
    if (at - wifiAt >= WIFI_MS) {
      const name = [...hw.keys()].find((k) => WIFI.test(k));
      wifi = t(name ? hw.get(name) : null);
      wifiAt = at;
    }
    return {
      cpu: t(hw.get('k10temp') ?? hw.get('coretemp') ?? hw.get('zenpower')),
      nvme,
      wifi,
      gpu: t(hw.get('amdgpu')),
    };
  };
}
