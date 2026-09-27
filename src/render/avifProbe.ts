// Locally generated 16x16 constant RGB image with alpha values 0..255, encoded losslessly.
// This is a codec test fixture, not character art. No network request is made.
const ALPHA_PROBE = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUEAAAGGbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAACxpbG9jAAAAAEQAAAIAAQAAAAEAAAH8AAAAJwACAAAAAQAAAa4AAABOAAAAQmlpbmYAAAAAAAIAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAABppbmZlAgAAAAACAABhdjAxQWxwaGEAAAAAGmlyZWYAAAAAAAAADmF1eGwAAgABAAEAAADDaXBycAAAAJ1pcGNvAAAAFGlzcGUAAAAAAAAAEAAAABAAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBIAAAAAAAE2NvbHJuY2x4AAEADQAGgAAAAA5waXhpAAAAAAEIAAAADGF2MUOBABwAAAAAOGF1eEMAAAAAdXJuOm1wZWc6bXBlZ0I6Y2ljcDpzeXN0ZW1zOmF1eGlsaWFyeTphbHBoYQAAAAAeaXBtYQAAAAAAAAACAAEEAQKDBAACBAEFhgcAAAB9bWRhdBIACgUYDP/YVDJDEABuBKcvs/I5z4JByLORmSIP8KkG5PuETp/GBSnuWVHi/17reeFbDi+T4JYeUXkMC7HSE/vSHfH1w5spMGLB3rMZgBIACgg4DP/aQENBpDIZFMJjJIEEEE8oAAAAOtxBfmKa/JUG7dp4Bg==';

/** Real decode and alpha check; MIME support strings alone are insufficient. */
export function probeAvifAlpha(signal: AbortSignal): Promise<boolean> {
  if (typeof Image === 'undefined' || typeof document === 'undefined' || signal.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    const image = new Image();
    let settled = false;
    const finish = (supported: boolean): void => {
      if (settled) return;
      settled = true; image.onload = null; image.onerror = null;
      signal.removeEventListener('abort', abort);
      resolve(supported);
    };
    const abort = (): void => finish(false);
    signal.addEventListener('abort', abort, { once: true });
    image.onerror = () => finish(false);
    image.onload = () => {
      try {
        if (image.naturalWidth !== 16 || image.naturalHeight !== 16) { finish(false); return; }
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) { finish(false); return; }
        context.drawImage(image, 0, 0);
        const bytes = context.getImageData(0, 0, 16, 16).data;
        finish(Array.from({ length: 256 }, (_, i) => bytes[i * 4 + 3] === i).every(Boolean));
        canvas.width = canvas.height = 1;
      } catch { finish(false); }
    };
    image.src = ALPHA_PROBE;
  });
}
