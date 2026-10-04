// The decomp_settings format, as its official reader 0.0.10 declares it. The single source of the
// specification: parseDecompYaml validates with it, the package's types are its output, and
// schema.json and SPEC.md's field reference are generated from it.
import * as z from 'zod';

/** An optional field. Left empty (`null`), it reads as missing. */
const optional = <Schema extends z.ZodType>(schema: Schema, meta: { description: string; examples?: string[] }) =>
  schema
    .nullish()
    // before the transform, where z.toJSONSchema keeps the examples
    .meta(meta)
    .transform((value) => value ?? undefined)
    .optional();

const paths = z
  .strictObject({
    target: z.string().meta({
      description: 'The original binary the project matches, often called the baserom.',
      examples: ['config/us/baserom_decompressed.us.z64'],
    }),
    build_dir: z.string().meta({
      description: 'The directory the build writes its artifacts to.',
      examples: ['build/us/'],
    }),
    map: z.string().meta({ description: 'The map file the build writes.', examples: ['build/us/drmario64.us.map'] }),
    compiled_target: z.string().meta({
      description: "The binary the project's build produces.",
      examples: ['build/us/drmario64_uncompressed.us.z64'],
    }),
    elf: optional(z.string(), {
      description: 'The intermediate ELF the build produces, if any.',
      examples: ['build/pokemonsnap.elf'],
    }),
    expected_dir: optional(z.string(), {
      description: 'The directory of expected build output to compare against, often a copy of the build directory.',
      examples: ['expected/'],
    }),
    asm: optional(z.string(), { description: 'The directory of disassembled assembly.', examples: ['asm/'] }),
    nonmatchings: optional(z.string(), {
      description: 'The directory of the functions and files still to match.',
      examples: ['asm/nonmatchings'],
    }),
    compressed_target: optional(z.string(), {
      description: 'The original binary before decompression, if the target is compressed.',
      examples: ['config/usa/rom_original.z64'],
    }),
    compressed_compiled_target: optional(z.string(), {
      description: 'The compressed binary the build produces, if any.',
      examples: ['build/usa/compressed_rom.z64'],
    }),
  })
  .meta({
    id: 'paths',
    description: "The files and directories tools need for this version, relative to the decomp.yaml's directory.",
  });

const version = z
  .strictObject({
    name: z.string().meta({ description: 'A short identifier for the version, easy to type.', examples: ['us10'] }),
    fullname: z.string().meta({ description: "The version's human-readable name.", examples: ['US 1.0'] }),
    sha1: optional(z.string(), {
      description: 'The SHA-1 of the target binary, so tools can check they work on the right one.',
    }),
    paths,
  })
  .meta({ id: 'version', description: 'One version of the target.' });

export const DECOMP_YAML = z
  .strictObject({
    name: z.string().meta({ description: "The project's human-readable name.", examples: ['Paper Mario'] }),
    repo: optional(z.string(), {
      description: "The project's repository URL.",
      examples: ['https://github.com/pmret/papermario'],
    }),
    website: optional(z.string(), { description: "The project's website." }),
    discord: optional(z.string(), { description: "An invite link to the project's Discord server." }),
    platform: z.string().meta({
      description: "The platform the project's game or program runs on.",
      examples: ['n64', 'gba', 'gc', 'ps2'],
    }),
    build_system: optional(z.string(), {
      description: 'The build system the project uses.',
      examples: ['make', 'ninja'],
    }),
    versions: z.array(version).meta({
      description: 'Every version of the target the project decompiles, such as each region or revision.',
    }),
    tools: optional(z.record(z.string(), z.unknown()), {
      description: "Settings for each tool, keyed by the tool's name. Each tool defines its own block.",
    }),
  })
  .meta({
    title: 'decomp.yaml',
    description:
      "A matching-decompilation project's settings, shared by the tools that work on it: the decomp_settings format (https://github.com/ethteck/decomp_settings), as its official reader 0.0.10 declares it.",
  });
