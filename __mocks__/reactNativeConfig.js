module.exports = new Proxy(
  {},
  {
    get(_target, property) {
      if (property === '__esModule') {
        return true;
      }
      if (property === 'default') {
        return module.exports;
      }
      return process.env[String(property)];
    },
  },
);
