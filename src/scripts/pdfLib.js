// Entry point for the separate pdf-lib bundle, loaded on demand by strip.js.
// Keeping it out of the main bundle saves every visitor ~500KB, since only
// uploads with metadata stripping enabled ever need it.
module.exports = require('pdf-lib')
