/**
 * amdgpu: gpu_busy_percent, mem_info_{vram,gtt}_{used,total} from the DRM card, clock/power/temp from the amdgpu hwmon.
 * No amdgpu → null.
 */
import type { Stats } from '../../../shared/protocol.ts';
import { num, read, list, hwmonByName } from './util.ts';

function findCard(root: string): string | null {
  for (const c of list(root, '/sys/class/drm').filter((d) => /^card\d+$/.test(d)).sort()) {
    const dir = `/sys/class/drm/${c}/device`;
    if (num(root, `${dir}/gpu_busy_percent`) !== null) return dir;
  }
  return null;
}

export function createGpu(root = '', now: () => number = () => performance.now()): () => Stats['gpu'] {
  let card = findCard(root);
  let hw: string | null = null, hwAt = -Infinity;
  return () => {
    card ??= findCard(root);
    if (!card) return null;
    const busy = num(root, `${card}/gpu_busy_percent`);
    if (busy === null) return null;
    if (now() - hwAt >= 60_000) {
      hw = hwmonByName(root).get('amdgpu') ?? null;
      hwAt = now();
    }
    let clockMHz = hw ? num(root, `${hw}/freq1_input`) : null;
    if (clockMHz !== null) clockMHz = Math.round(clockMHz / 1e6);
    else {
      const m = /(\d+)Mhz\s*\*/i.exec(read(root, `${card}/pp_dpm_sclk`) ?? '');
      clockMHz = m ? Number(m[1]) : 0;
    }
    const pw = hw ? num(root, `${hw}/power1_average`) ?? num(root, `${hw}/power1_input`) : null;
    const tc = hw ? num(root, `${hw}/temp1_input`) : null;
    return {
      busy,
      vramUsed: num(root, `${card}/mem_info_vram_used`) ?? 0,
      vramTotal: num(root, `${card}/mem_info_vram_total`) ?? 0,
      gttUsed: num(root, `${card}/mem_info_gtt_used`) ?? 0,
      gttTotal: num(root, `${card}/mem_info_gtt_total`) ?? 0,
      clockMHz,
      powerW: pw === null ? 0 : Math.round(pw / 1e5) / 10,
      tempC: tc === null ? 0 : Math.round(tc / 100) / 10,
    };
  };
}
