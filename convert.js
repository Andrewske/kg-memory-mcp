#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { glob } from 'glob';
import path from 'path';

console.log('🔧 Converting relative imports to alias imports (advanced)...');

const tsFiles = glob.sync('src/**/*.ts');
let totalFiles = 0;
let totalReplacements = 0;

function resolveImportPath(currentFile, importPath) {
  // Get the directory of the current file
  const currentDir = path.dirname(currentFile);
  
  // Resolve the full path of the import
  const fullPath = path.resolve(currentDir, importPath);
  
  // Get the path relative to src/
  const srcPath = path.resolve('src');
  const relativePath = path.relative(srcPath, fullPath);
  
  // If the path goes outside src/, don't convert
  if (relativePath.startsWith('..')) {
    return null;
  }
  
  // Convert to alias
  return `~/${relativePath.replace(/\\/g, '/')}`;
}

tsFiles.forEach(file => {
  let content = readFileSync(file, 'utf8');
  let hasChanges = false;
  let fileReplacements = 0;
  
  // Pattern for all relative imports (both ./ and ../)
  const relativePattern = /from (['"])(\.\.?\/[^'"]+)\1/g;
  content = content.replace(relativePattern, (match, quote, importPath) => {
    // Only convert ../ imports (parent directory)
    if (!importPath.startsWith('../')) {
      return match;
    }
    
    const aliasPath = resolveImportPath(file, importPath);
    if (aliasPath) {
      hasChanges = true;
      fileReplacements++;
      return `from ${quote}${aliasPath}${quote}`;
    }
    return match;
  });
  
  // Dynamic imports
  const dynamicPattern = /import\((['"])(\.\.?\/[^'"]+)\1\)/g;
  content = content.replace(dynamicPattern, (match, quote, importPath) => {
    if (!importPath.startsWith('../')) {
      return match;
    }
    
    const aliasPath = resolveImportPath(file, importPath);
    if (aliasPath) {
      hasChanges = true;
      fileReplacements++;
      return `import(${quote}${aliasPath}${quote})`;
    }
    return match;
  });
  
  if (hasChanges) {
    writeFileSync(file, content);
    console.log(`✅ ${file}: ${fileReplacements} imports converted`);
    totalFiles++;
    totalReplacements += fileReplacements;
  }
});

console.log(`\n🎉 Completed!`);
console.log(`📁 Files modified: ${totalFiles}`);
console.log(`🔄 Total imports converted: ${totalReplacements}`);

// Run Biome to format
if (totalFiles > 0) {
  console.log('\n🎨 Running Biome format and organize imports...');
  try {
    execSync('npx biome check --write src/', { stdio: 'inherit' });
    console.log('✅ Biome completed');
  } catch (error) {
    console.log('⚠️  Biome failed, but imports were converted');
  }
}

if (totalReplacements === 0) {
  console.log('💡 No ../ imports found to convert. All imports are already using aliases or same-directory imports.');
}