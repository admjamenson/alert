const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const sourceMapPath = path.join(
  projectRoot,
  'android',
  'app',
  'build',
  'generated',
  'sourcemaps',
  'react',
  'debug',
  'index.android.bundle.map',
);

const fallbackLogoPath = path.join(
  projectRoot,
  'android',
  'app',
  'src',
  'main',
  'res',
  'mipmap-xxxhdpi',
  'ic_launcher.png',
);

const shouldRecoverSource = absolutePath =>
  /^C:\\Alert\\src\\/i.test(absolutePath.replace(/\//g, '\\')) ||
  /^C:\\Alert\\src\\/i.test(absolutePath) ||
  /^C:\\Alert\\App\.tsx$/i.test(absolutePath) ||
  /^C:\\Alert\\index\.js$/i.test(absolutePath);

const writeRecoveredFile = (absolutePath, content) => {
  const relativePath = path.relative('C:\\Alert', absolutePath);
  const targetPath = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
  return targetPath;
};

const recoverLogoAsset = () => {
  const targetPath = path.join(projectRoot, 'src', 'assets', 'logo.png');
  if (fs.existsSync(targetPath)) {
    return null;
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(fallbackLogoPath, targetPath);
  return targetPath;
};

const main = () => {
  if (!fs.existsSync(sourceMapPath)) {
    throw new Error(`missing_source_map: ${sourceMapPath}`);
  }

  const sourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
  const sources = Array.isArray(sourceMap.sources) ? sourceMap.sources : [];
  const contents = Array.isArray(sourceMap.sourcesContent)
    ? sourceMap.sourcesContent
    : [];

  const recovered = [];

  for (let index = 0; index < sources.length; index += 1) {
    const absolutePath = String(sources[index] || '');
    const content = contents[index];

    if (!shouldRecoverSource(absolutePath)) {
      continue;
    }

    if (typeof content !== 'string' || !content.length) {
      continue;
    }

    recovered.push(writeRecoveredFile(absolutePath, content));
  }

  const recoveredLogo = recoverLogoAsset();
  if (recoveredLogo) {
    recovered.push(recoveredLogo);
  }

  console.log(
    JSON.stringify(
      {
        recoveredCount: recovered.length,
        recoveredRoots: [...new Set(recovered.map(file => path.dirname(file)))].length,
        sample: recovered.slice(0, 12),
      },
      null,
      2,
    ),
  );
};

main();
