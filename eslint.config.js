import jsdoc from 'eslint-plugin-jsdoc';

export default [
  {
    ...jsdoc.configs['flat/recommended'],
    files: ['src/yt-subs-*.js'],
  },
];
