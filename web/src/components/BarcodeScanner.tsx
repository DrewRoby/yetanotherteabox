import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";

// Camera-based barcode reader — the read side of the barcode value written by
// Barcode.tsx / assigned server-side by formatBarcode() (server/src/lib/barcode.ts).
// Decodes continuously off the device camera via getUserMedia; a real USB HID scanner
// still works too, since it just types into whatever text input has focus (see
// PosPage's plain "Scan Input" field) — this component is for devices with a camera
// but no physical scanner attached.
export function BarcodeScanner({
  onDetect,
  onClose,
}: {
  onDetect: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const lastDetectedRef = useRef<{ code: string; at: number } | null>(null);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let controls: IScannerControls | undefined;
    let cancelled = false;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
        if (!result) return;
        const code = result.getText();
        const now = Date.now();
        const last = lastDetectedRef.current;
        // Suppress re-firing the same code for 2s so holding a tag under the camera
        // doesn't spam duplicate detections.
        if (last && last.code === code && now - last.at < 2000) return;
        lastDetectedRef.current = { code, at: now };
        onDetect(code);
      })
      .then((c) => {
        if (cancelled) {
          c.stop();
          return;
        }
        controls = c;
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Could not access camera.");
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-white border-2 border-ink p-4 w-[420px]">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-bold uppercase text-sm">Scan with Camera</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-crimson">
            ✕
          </button>
        </div>
        {error ? (
          <div className="text-crimson text-sm p-4 text-center">{error}</div>
        ) : (
          <video ref={videoRef} className="w-full bg-black" muted playsInline />
        )}
        <p className="text-[11px] text-gray-500 mt-2 text-center">
          Hold a barcode up to the camera. Detected codes are added automatically.
        </p>
      </div>
    </div>
  );
}
