// Sets the app icon + version info on the Windows exe without wine (pure JS via resedit).
const fs = require('fs');
const path = require('path');
module.exports = async function (ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const ResEdit = require('resedit');
  const exeName = ctx.packager.appInfo.productFilename + '.exe';
  const exe = path.join(ctx.appOutDir, exeName);
  const data = fs.readFileSync(exe);
  const ntExe = ResEdit.NtExecutable.from(data, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(ntExe);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const id = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, iconFile.icons.map(i => i.data));
  const vis = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const v = ctx.packager.appInfo.version.split('.').map(Number);
  for (const vi of vis) {
    vi.setFileVersion(v[0], v[1], v[2], 0);
    vi.setProductVersion(v[0], v[1], v[2], 0);
    for (const l of vi.getAllLanguagesForStringValues()) {
      vi.setStringValues(l, {
        FileDescription: 'T212 Widget',
        ProductName: 'T212 Widget',
        CompanyName: 'Jovan',
        OriginalFilename: exeName,
        InternalName: 'T212 Widget',
        LegalCopyright: '© 2026 Jovan'
      });
    }
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(ntExe);
  fs.writeFileSync(exe, Buffer.from(ntExe.generate()));
  console.log('  • resedit: icon + version info written to', exeName);
};
