import { addViteConfig, defineWxtModule } from '../modules';
import type {
  EslintGlobalsPropValue,
  WxtDirFileEntry,
  WxtModule,
  WxtResolvedUnimportOptions,
} from '../types';
import { type Unimport, createUnimport } from 'unimport';
import UnimportPlugin from 'unimport/unplugin';

export default defineWxtModule({
  name: 'wxt:built-in:unimport',
  setup(wxt) {
    const options = wxt.config.imports;
    if (options === false) return;

    let unimport: Unimport;

    // Add user module imports to config
    wxt.hooks.hook('config:resolved', () => {
      const addModuleImports = (module: WxtModule<any>) => {
        if (!module.imports) return;

        options.imports ??= [];
        options.imports.push(...module.imports);
      };

      wxt.config.builtinModules.forEach(addModuleImports);
      wxt.config.userModules.forEach(addModuleImports);
    });

    // Create unimport instance AFTER "config:resolved" so any modifications to the
    // config inside "config:resolved" are applied.
    wxt.hooks.afterEach((event) => {
      if (event.name === 'config:resolved') {
        unimport = createUnimport(options);
      }
    });

    // Generate types
    wxt.hooks.hook('prepare:types', async (_, entries) => {
      // Update cache before each rebuild
      await unimport.init();

      entries.push(await getImportsDeclarationEntry(unimport));

      if (options.eslintrc.enabled === false) return;
      entries.push(
        await getEslintConfigEntry(unimport, options.eslintrc.enabled, options),
      );
    });

    // Add vite plugin
    addViteConfig(wxt, () => ({
      plugins: [UnimportPlugin.vite(options)],
    }));
  },
});

async function getImportsDeclarationEntry(
  unimport: Unimport,
): Promise<WxtDirFileEntry> {
  // Load project imports into unimport memory so they are output via generateTypeDeclarations
  await unimport.init();

  return {
    path: 'types/imports.d.ts',
    text: [
      '// Generated by wxt',
      await unimport.generateTypeDeclarations(),
      '',
    ].join('\n'),
    tsReference: true,
  };
}

async function getEslintConfigEntry(
  unimport: Unimport,
  version: 8 | 9,
  options: WxtResolvedUnimportOptions,
): Promise<WxtDirFileEntry> {
  const globals = (await unimport.getImports())
    .map((i) => i.as ?? i.name)
    .filter(Boolean)
    .sort()
    .reduce<Record<string, EslintGlobalsPropValue>>((globals, name) => {
      globals[name] = options.eslintrc.globalsPropValue;
      return globals;
    }, {});

  if (version <= 8) return getEslint8ConfigEntry(options, globals);
  else return getEslint9ConfigEntry(options, globals);
}

export function getEslint8ConfigEntry(
  options: WxtResolvedUnimportOptions,
  globals: Record<string, EslintGlobalsPropValue>,
): WxtDirFileEntry {
  return {
    path: options.eslintrc.filePath,
    text: JSON.stringify({ globals }, null, 2) + '\n',
  };
}

export function getEslint9ConfigEntry(
  options: WxtResolvedUnimportOptions,
  globals: Record<string, EslintGlobalsPropValue>,
): WxtDirFileEntry {
  return {
    path: options.eslintrc.filePath,
    text: `const globals = ${JSON.stringify(globals, null, 2)}

export default {
  name: "wxt/auto-imports",
  languageOptions: {
    globals,
    sourceType: "module",
  },
};
`,
  };
}
