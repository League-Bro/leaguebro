import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Hide icons that fail to load (e.g. offline) instead of showing a broken-image glyph.
document.addEventListener(
  'error',
  (e) => {
    if (e.target instanceof HTMLImageElement) e.target.style.visibility = 'hidden';
  },
  true,
);

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
