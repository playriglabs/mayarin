import { Toaster as Sonner } from "sonner";

export default function Toaster() {
  return (
    <Sonner
      className="mayarin-toaster"
      position="bottom-right"
      closeButton
      duration={4_000}
      toastOptions={{ className: "font-sans" }}
    />
  );
}
