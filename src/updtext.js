// Update messages shared by the update window and the settings page.
import { t } from './i18n.js';

export const UPD_ERR = {
  notfound: 'No release found on GitHub — the repository has to be public for in-app updates.',
  auth: 'GitHub refused the request.',
  rate: 'GitHub is rate limiting — will try again later.',
  network: 'GitHub is unreachable — check the connection.',
  http: 'GitHub returned an error.',
  verify: 'The download couldn’t be verified against the release — not installing.',
  noasset: 'The release has no file for this computer.'
};
export const updErr = e => t(UPD_ERR[e && e.kind] || UPD_ERR.http);

export const BLOCKER = {
  dev: 'This is a development build — install the new version from the release page.',
  noasset: 'The release has no file for this computer — download it from the release page.',
  translocated: 'macOS is running the app from a temporary location. Move T212 Widget to Applications and start it from there — then it can update itself.',
  readonly: 'The app folder is read-only for your account, so it can’t update itself in place.'
};
