import { useEffect, useState } from "react";
import { Button, Card } from "../../components/Card";
import { CodeFormatToggle } from "./CodeFormatToggle";
import {
  barcodeUnsupportedReason,
  codeFilename,
  downloadDataUrl,
  renderCodeToDataUrl,
  type CodeFormat,
} from "../../lib/codeImage";

// Reports > Barcode Generator: any text in, a PNG barcode or QR code out. Rendered
// entirely client-side — nothing is sent to or stored on the server.
export function BarcodeGenerator() {
  const [text, setText] = useState("");
  const [format, setFormat] = useState<CodeFormat>("BARCODE");
  const [showText, setShowText] = useState(true);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (!text) {
      setImage(null);
      return;
    }
    if (format === "BARCODE") {
      const reason = barcodeUnsupportedReason(text);
      if (reason) {
        setImage(null);
        setError(reason);
        return;
      }
    }
    renderCodeToDataUrl(text, format, { showText })
      .then((url) => !cancelled && setImage(url))
      .catch((err: Error) => {
        if (cancelled) return;
        setImage(null);
        setError(err.message || "Could not render that text.");
      });
    return () => {
      cancelled = true;
    };
  }, [text, format, showText]);

  return (
    <div className="grid grid-cols-2 gap-6">
      <Card>
        <h3 className="font-bold uppercase tracking-wide mb-4">Barcode Generator</h3>
        <label className="block text-xs font-bold uppercase tracking-wide mb-2" htmlFor="code-text">
          Text to encode
        </label>
        <textarea
          id="code-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="e.g. SALE-RACK-A, a URL, a shelf label…"
          className="w-full border border-ink p-2 text-sm font-mono mb-4 focus:outline-none focus:border-crimson"
        />
        <div className="flex flex-wrap items-center gap-4">
          <CodeFormatToggle value={format} onChange={setFormat} />
          {format === "BARCODE" && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={showText} onChange={(e) => setShowText(e.target.checked)} />
              Print text under barcode
            </label>
          )}
        </div>
      </Card>

      <Card className="flex flex-col items-center justify-center min-h-[240px]">
        {image ? (
          <>
            <img src={image} alt={`${format === "QR" ? "QR code" : "Barcode"} for ${text}`} className="max-w-full mb-4" />
            <Button onClick={() => downloadDataUrl(image, codeFilename(text, format))}>Download PNG</Button>
          </>
        ) : error ? (
          <p className="text-crimson text-sm font-semibold text-center">{error}</p>
        ) : (
          <p className="text-gray-400 text-sm">Preview appears here.</p>
        )}
      </Card>
    </div>
  );
}
