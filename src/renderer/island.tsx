/** The live overlay. Sample data is confined to the gallery/browser preview. */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './island.css';
import { CompanionSurface, useCompanion } from './LiveCompanion';

function App() {
  const live = useCompanion();
  const [hovering, setHovering] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const stopHover = window.claudeLight.onHover(setHovering);
    const stopOpen = window.claudeLight.onOpen(setOpen);
    return () => { stopHover(); stopOpen(); };
  }, []);
  return <CompanionSurface live={live} open={open} hovering={hovering} onBox={r => window.claudeLight.setHitRect(r)} onCustomize={() => window.claudeLight.openCustomize()}/>;
}
createRoot(document.getElementById('root')!).render(<App/>);
