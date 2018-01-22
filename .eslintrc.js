module.exports = {
  extends: ['joblift/2space', 'joblift/jest'],
  env: {
    node: true,
    jest: true,
    es6: true,
  },
  rules: {
    'max-lines': 0,
    'func-names': 0,
  },
};