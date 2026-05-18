module.exports = {
  'env': {
    'browser': true,
    'es2021': true,
  },
  'extends': [
    'plugin:react/recommended',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  'parser': '@typescript-eslint/parser',
  'parserOptions': {
    'ecmaFeatures': {
      'jsx': true,
      'tsx': true,
    },
    'ecmaVersion': 12,
    'sourceType': 'module',
  },
  'plugins': [
    'react',
    '@typescript-eslint',
  ],
  'rules': {
    'linebreak-style': 0,
    'quotes': ['error', 'single'],
    'semi': 'off',
    '@typescript-eslint/semi': ['error'],
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-empty-interface': 'off',
    'comma-dangle': ['error', {
      'arrays': 'always-multiline',
      'objects': 'always-multiline',
      'imports': 'always-multiline',
      'exports': 'always-multiline',
      'functions': 'ignore',
    }],
    'no-console': 'off',
    'object-curly-spacing': 'off',
    'array-bracket-spacing': 'off',
    'require-jsdoc': 'off',
    'max-len': [
      1,
      120,
      2,
      { ignoreComments: true, ignoreUrls: true, ignoreStrings: true },
    ],
    'camelcase': 'off',
    'new-cap': 'off',
    'react/jsx-uses-react': 'off',
    'react/react-in-jsx-scope': 'off',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
    ],
    'guard-for-in': 'off',
    'react/display-name': 'off',
    'prettier/prettier': [
      'error',
      {
        'endOfLine': 'auto',
      },
    ],
  },
  'settings': {
    'react': {
      'version': 'detect',
    },
  },
};