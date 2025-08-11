const path = require('path');

module.exports = (request, options) => {
  // Handle ~ alias
  if (request.startsWith('~/')) {
    const aliasedRequest = path.resolve(options.basedir, 'src', request.slice(2));
    try {
      return options.defaultResolver(aliasedRequest, options);
    } catch (error) {
      // Try with .ts extension
      const tsRequest = aliasedRequest.replace(/\.js$/, '.ts');
      return options.defaultResolver(tsRequest, options);
    }
  }

  // Handle .js imports for TypeScript files
  if (request.endsWith('.js') && !request.includes('node_modules')) {
    const tsRequest = request.replace(/\.js$/, '.ts');
    try {
      return options.defaultResolver(tsRequest, options);
    } catch (error) {
      // If .ts doesn't exist, try .js
      return options.defaultResolver(request, options);
    }
  }

  // Default resolution
  return options.defaultResolver(request, options);
};