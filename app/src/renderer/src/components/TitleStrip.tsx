import logo from "../assets/brand/nonon-logo-horizontal-color.svg";

/**
 * The window's top strip. The native frame is hidden (main/window-chrome.ts), so this is the title bar: the brand logo on
 * the left, the whole strip draggable, and on Windows the three caption buttons painted over its right edge by the OS.
 * Nothing interactive lives in it. Colour and height come from --chrome-bg and --chrome (styles.css) and must match main.
 */
export function TitleStrip() {
  return (
    <header className="titlestrip">
      <img className="titlestrip-logo" src={logo} alt="NONON" draggable={false} />
    </header>
  );
}
