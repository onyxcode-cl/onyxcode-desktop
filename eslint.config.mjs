// ESLint 9 flat config. NO bloquea: no forma parte de typecheck/build/hooks (Fase 6, D7).
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'pwa/dist/**', 'node_modules/**', 'resources/**', '**/*.tsbuildinfo', '**/*.d.ts'] },
  ...tseslint.configs.recommended,
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'prefer-const': 'warn', // estilo, no un fallo real
      // Ruidosas en el código existente: aviso, no error (se revisan en la Fase 7).
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ]
    }
  }
)
