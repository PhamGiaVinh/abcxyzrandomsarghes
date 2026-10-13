import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadDeploymentManifest,
  mergeContracts,
  parseTargetList,
  resolveTargetContracts,
} from "./deployment-manifest.mjs";
import { selectTargetContractProfile } from "./target-contract-profile.mjs";
import { inspectImportGraph } from "./verify-target-source.mjs";

const FRONTEND_CONTRACT_FILES = [
  "VinPoker/src/components/cashier/DealerSwingTab.tsx",
  "VinPoker/src/lib/dealerMassOpen.ts",
];
const PHYSICAL_ASSET_RPC_CONTRACT = {
  type: "function", name: "public.declare_club_physical_table_v1",
  arguments: ["p_club_id","p_table_number","p_request_id","p_expected_actor_id"],
  argumentTypes: ["uuid","integer","uuid","uuid"],allowOtherOverloads:false,
  acl:{authenticated:true,anon:false,service_role:false},dependencyKind:"direct_frontend_source",
};
const SCOPED_STOP_RPC_CONTRACT = {
  type:"function",name:"public.operator_stop_dealer_swing_v1",
  arguments:["p_club_id","p_request_id","p_expected_actor_id"],argumentTypes:["uuid","uuid","uuid"],
  allowOtherOverloads:false,acl:{authenticated:true,anon:false,service_role:false},dependencyKind:"direct_frontend_source",
};
const MANUAL_PLAYER_RPC_CONTRACTS = [
  {type:"function",name:"public.floor_add_manual_player_v1",
    arguments:["p_tournament_id","p_player_name","p_tournament_table_id","p_seat_number","p_table_session_id","p_expected_revision","p_expected_control_epoch","p_request_id","p_expected_actor_id"],
    argumentTypes:["uuid","text","uuid","integer","uuid","bigint","bigint","uuid","uuid"],
    allowOtherOverloads:false,acl:{authenticated:true,anon:false,service_role:false},dependencyKind:"direct_frontend_source"},
  {type:"function",name:"public.get_floor_manual_player_receipt_v1",
    arguments:["p_tournament_id","p_request_id","p_expected_actor_id"],argumentTypes:["uuid","uuid","uuid"],
    allowOtherOverloads:false,acl:{authenticated:true,anon:false,service_role:false},dependencyKind:"direct_frontend_source"},
];
function manualPlayerFrontendEnabled(targetRoot) {
  const component=resolve(targetRoot,"VinPoker/src/components/cashier/tournament-live/AddPlayerDialog.tsx");
  if(!existsSync(component)) return false;
  const source=readFileSync(component,"utf8");
  if(source.includes("client.addManualPlayer(") && source.includes("client.getManualPlayerReceipt(")) {
    const client=resolve(targetRoot,"VinPoker/src/lib/floorTableControlV3.ts");
    if(!existsSync(client)||!MANUAL_PLAYER_RPC_CONTRACTS.every(c=>readFileSync(client,"utf8").includes(`call("${c.name.slice(7)}"`)))
      throw Error("UNKNOWN_TARGET_MANUAL_PLAYER_CONTRACT");
    return true;
  }
  if(source.includes('"floor_assign_player_to_seat"')) return false;
  throw Error("UNKNOWN_TARGET_MANUAL_PLAYER_CONTRACT");
}
const ISSUANCE_RPC_CONTRACTS = [
  ["get_chip_issuance_state_v1",["p_stack_template_id","p_expected_actor"],["uuid","uuid"]],
  ...["chip_ops_set_issuance_v2","get_chip_issuance_receipt_v1"].map(name=>[name,
    ["p_stack_template_id","p_issued_count","p_expected_revision","p_request_id","p_expected_actor"],
    ["uuid","integer","bigint","uuid","uuid"]]),
].map(([name,arguments_,argumentTypes])=>({type:"function",name:`public.${name}`,arguments:arguments_,argumentTypes,
  allowOtherOverloads:false,acl:{authenticated:true,anon:false,service_role:false},dependencyKind:"direct_frontend_source"}));
function issuanceFrontendEnabled(targetRoot) {
  const manager=resolve(targetRoot,"VinPoker/src/components/chip-ops/ChipOpsManager.tsx");
  if(!existsSync(manager)||!readFileSync(manager,"utf8").includes('from "./IssuanceCard"')) return false;
  const component=resolve(targetRoot,"VinPoker/src/components/chip-ops/IssuanceCard.tsx");
  if(!existsSync(component)||!ISSUANCE_RPC_CONTRACTS.every(c=>readFileSync(component,"utf8").includes(`"${c.name.slice(7)}"`)))
    throw Error("UNKNOWN_TARGET_ISSUANCE_CONTRACT");
  return true;
}
function scopedStopFrontendEnabled(targetRoot) {
  const tab=resolve(targetRoot,FRONTEND_CONTRACT_FILES[0]);
  if(!existsSync(tab)||!readFileSync(tab,"utf8").includes("DealerSwingStopControl")) return false;
  const component=resolve(targetRoot,"VinPoker/src/components/cashier/dealer-swing/DealerSwingStopControl.tsx");
  if(!existsSync(component)) throw Error("UNKNOWN_TARGET_SCOPED_STOP_CONTRACT");
  const source=readFileSync(component,"utf8");
  if(/\.rpc\(\s*["']operator_stop_dealer_swing_v1["']/.test(source)) return true;
  if(!source.includes("operator_stop_dealer_swing_v1")&&
    /\.from\(\s*["']club_settings["']\s*\)\s*\.upsert\(\s*\{[^}]*auto_swing_enabled:\s*false\b/.test(source)) return false;
  throw Error("UNKNOWN_TARGET_SCOPED_STOP_CONTRACT");
}
function physicalAssetFrontendEnabled(targetRoot) {
  const tab=resolve(targetRoot,FRONTEND_CONTRACT_FILES[0]);
  if(!existsSync(tab)||!readFileSync(tab,"utf8").includes("PhysicalTableDeclaration")) return false;
  const component=resolve(targetRoot,"VinPoker/src/components/cashier/dealer-swing/PhysicalTableDeclaration.tsx");
  const client=resolve(targetRoot,"VinPoker/src/lib/floorTableControlV3.ts");
  if(!existsSync(component)||!existsSync(client)||!readFileSync(client,"utf8").includes('rpc("declare_club_physical_table_v1"'))
    throw Error("UNKNOWN_TARGET_PHYSICAL_ASSET_CONTRACT");
  return true;
}
function assertFrontendFunctionBackend(catalog,contract,definitionMd5,configuration,errorPrefix) {
  if(!Array.isArray(catalog?.functions)) throw Error(`${errorPrefix}_REQUIRES_QUALIFIED_CATALOG`);
  const functionName=contract.name.slice("public.".length);
  const matches=catalog.functions.filter(fn=>fn.schema==="public"&&fn.name===functionName);
  const fn=matches[0];
  if(matches.length!==1||fn?.owner!=="postgres"||fn.securityDefiner!==true
    ||JSON.stringify(fn.configuration)!==JSON.stringify(configuration)
    ||fn.definitionMd5!==definitionMd5||findMissingContracts(catalog,[contract]).length>0)
    throw Error(`${errorPrefix}_BACKEND_NOT_QUALIFIED`);
}
export function assertPhysicalAssetFrontendBackend({targetRoot,catalog}) {
  if(physicalAssetFrontendEnabled(targetRoot)) assertFrontendFunctionBackend(catalog,PHYSICAL_ASSET_RPC_CONTRACT,
    "c4c0bab3f601386c8b4f44d849c255df",['search_path=""'],"PHYSICAL_ASSET_FRONTEND");
}
export function assertScopedStopFrontendBackend({targetRoot,catalog}) {
  if(scopedStopFrontendEnabled(targetRoot)) assertFrontendFunctionBackend(catalog,SCOPED_STOP_RPC_CONTRACT,
    "32558a200e5c94c5bfcf0687b2a97ed2",['search_path=""','lock_timeout=5s'],"SCOPED_STOP_FRONTEND");
}
export function assertManualPlayerFrontendBackend({targetRoot,catalog}) {
  if(manualPlayerFrontendEnabled(targetRoot)) MANUAL_PLAYER_RPC_CONTRACTS.forEach((contract,index)=>
    assertFrontendFunctionBackend(catalog,contract,["8afb253f61ac4fa45fcd1cda00804929","be4d3310eded14b0690ef37725936781"][index],
      ['search_path=""'],"MANUAL_PLAYER_FRONTEND"));
}
export function assertIssuanceFrontendBackend({targetRoot,catalog}) {
  if(issuanceFrontendEnabled(targetRoot)) ISSUANCE_RPC_CONTRACTS.forEach((contract,index)=>
    assertFrontendFunctionBackend(catalog,contract,["2f309c9d033c925afa4d0deed67e62ef","ad1862dbd8f800353f9dd9ec2d5bb0b9","b0f1e752c6e46d1d08a019e1aebc7f87"][index],
      ['search_path=""'],"ISSUANCE_FRONTEND"));
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument near ${key ?? "end"}`);
    args.set(key.slice(2), value);
  }
  return args;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeType(type) {
  return type
    .replaceAll('"', "")
    .replace(/\bpg_catalog\./gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseIdentifierPart(source, offset = 0) {
  let index = offset;
  while (/\s/.test(source[index] ?? "")) index += 1;
  if (source[index] === '"') {
    let value = "";
    index += 1;
    while (index < source.length) {
      if (source[index] === '"' && source[index + 1] === '"') {
        value += '"';
        index += 2;
      } else if (source[index] === '"') {
        return { value, next: index + 1 };
      } else {
        value += source[index];
        index += 1;
      }
    }
    return null;
  }
  const match = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_$]*/);
  if (!match) return null;
  return { value: match[0].toLowerCase(), next: index + match[0].length };
}

function parseQualifiedIdentifier(source, offset = 0) {
  const first = parseIdentifierPart(source, offset);
  if (!first) return null;
  let index = first.next;
  while (/\s/.test(source[index] ?? "")) index += 1;
  if (source[index] !== ".") return { value: first.value, next: index };
  const second = parseIdentifierPart(source, index + 1);
  if (!second) return null;
  return { value: `${first.value}.${second.value}`, next: second.next };
}

function normalizeIdentifier(identifier) {
  const parsed = parseQualifiedIdentifier(String(identifier).trim());
  return parsed && parsed.next === String(identifier).trim().length
    ? parsed.value
    : String(identifier).replaceAll('"', "").trim().toLowerCase();
}

function splitSqlStatements(source) {
  const statements = [];
  let current = "";
  let index = 0;
  let state = "normal";
  let dollarTag = null;

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "normal") {
      if (character === "-" && next === "-") {
        const newline = source.indexOf("\n", index + 2);
        current += newline === -1 ? "" : "\n";
        index = newline === -1 ? source.length : newline + 1;
        continue;
      }
      if (character === "/" && next === "*") {
        const end = source.indexOf("*/", index + 2);
        const comment = source.slice(index, end === -1 ? source.length : end + 2);
        current += comment.replace(/[^\n]/g, " ");
        index = end === -1 ? source.length : end + 2;
        continue;
      }
      if (character === "'") state = "single";
      if (character === '"') state = "double";
      if (character === "$") {
        const tag = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
        if (tag) {
          state = "dollar";
          dollarTag = tag;
          current += tag;
          index += tag.length;
          continue;
        }
      }
      if (character === ";") {
        if (current.trim()) statements.push(current);
        current = "";
        index += 1;
        continue;
      }
      current += character;
      index += 1;
      continue;
    }
    if (state === "single") {
      current += character;
      if (character === "'" && next === "'") {
        current += next;
        index += 2;
      } else {
        if (character === "'") state = "normal";
        index += 1;
      }
      continue;
    }
    if (state === "double") {
      current += character;
      if (character === '"' && next === '"') {
        current += next;
        index += 2;
      } else {
        if (character === '"') state = "normal";
        index += 1;
      }
      continue;
    }
    if (state === "dollar") {
      if (source.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length;
        state = "normal";
        dollarTag = null;
      } else {
        current += character;
        index += 1;
      }
    }
  }
  return statements;
}

function findBalancedParentheses(source, start) {
  if (source[start] !== "(") return null;
  let depth = 0;
  let index = start;
  let state = "normal";
  let dollarTag = null;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "normal") {
      if (character === "'") state = "single";
      else if (character === '"') state = "double";
      else if (character === "$") {
        const tag = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
        if (tag) {
          state = "dollar";
          dollarTag = tag;
          index += tag.length;
          continue;
        }
      } else if (character === "(") depth += 1;
      else if (character === ")") {
        depth -= 1;
        if (depth === 0) return { body: source.slice(start + 1, index), next: index + 1 };
      }
    } else if (state === "single") {
      if (character === "'" && next === "'") {
        index += 2;
        continue;
      }
      if (character === "'") state = "normal";
    } else if (state === "double") {
      if (character === '"' && next === '"') {
        index += 2;
        continue;
      }
      if (character === '"') state = "normal";
    } else if (state === "dollar" && source.startsWith(dollarTag, index)) {
      index += dollarTag.length;
      state = "normal";
      dollarTag = null;
      continue;
    }
    index += 1;
  }
  return null;
}

function splitArguments(argumentSource) {
  const parts = [];
  let depth = 0;
  let current = "";
  let state = "normal";
  for (let index = 0; index < argumentSource.length; index += 1) {
    const character = argumentSource[index];
    const next = argumentSource[index + 1];
    if (state === "single") {
      current += character;
      if (character === "'" && next === "'") {
        current += next;
        index += 1;
      } else if (character === "'") state = "normal";
      continue;
    }
    if (state === "double") {
      current += character;
      if (character === '"' && next === '"') {
        current += next;
        index += 1;
      } else if (character === '"') state = "normal";
      continue;
    }
    if (character === "'") state = "single";
    if (character === '"') state = "double";
    if (character === "(" || character === "[") depth += 1;
    if (character === ")" || character === "]") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function argumentParts(argument) {
  const withoutMode = argument.replace(/^\s*(?:inout|in|out|variadic)\s+/i, "").trim();
  const name = parseIdentifierPart(withoutMode);
  if (!name) return { name: null, type: normalizeType(withoutMode.replace(/\s+(?:DEFAULT|=)[\s\S]*$/i, "")) };
  const rawRemainder = withoutMode.slice(name.next);
  if (!/^\s+/.test(rawRemainder)) {
    return { name: null, type: normalizeType(withoutMode.replace(/\s+(?:DEFAULT|=)[\s\S]*$/i, "")) };
  }
  const remainder = rawRemainder.trim();
  if (!remainder) return { name: null, type: normalizeType(withoutMode.replace(/\s+(?:DEFAULT|=)[\s\S]*$/i, "")) };
  return {
    name: name.value,
    type: normalizeType(remainder.replace(/\s+(?:DEFAULT|=)[\s\S]*$/i, "")),
  };
}

function signatureKey(name, argumentTypes) {
  return `${normalizeIdentifier(name)}(${argumentTypes.map(normalizeType).join(",")})`;
}

function aclState() {
  return { publicExecute: true, grants: new Set() };
}

function parseAcl(statements, knownSignatures) {
  const bySignature = new Map([...knownSignatures].map((key) => [key, aclState()]));
  for (const statement of statements) {
    const match = statement.match(/^\s*(GRANT|REVOKE)\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+/i);
    if (!match) continue;
    const functionName = parseQualifiedIdentifier(statement, match[0].length);
    if (!functionName) continue;
    const opening = statement.indexOf("(", functionName.next);
    const argumentsPart = opening === -1 ? null : findBalancedParentheses(statement, opening);
    if (!argumentsPart) continue;
    const roleMatch = statement.slice(argumentsPart.next).match(/^\s+(?:TO|FROM)\s+([\s\S]+)$/i);
    if (!roleMatch) continue;
    const argumentTypes = splitArguments(argumentsPart.body).map((argument) => argumentParts(argument).type);
    const key = signatureKey(functionName.value, argumentTypes);
    const state = bySignature.get(key) ?? aclState();
    const roles = splitArguments(roleMatch[1]).map((role) => normalizeIdentifier(role));
    for (const role of roles) {
      if (role === "public") state.publicExecute = match[1].toUpperCase() === "GRANT";
      else if (match[1].toUpperCase() === "GRANT") state.grants.add(role);
      else state.grants.delete(role);
    }
    bySignature.set(key, state);
  }
  return bySignature;
}

function relationKind(kind) {
  if (/^MATERIALIZED\s+VIEW$/i.test(kind)) return "m";
  if (/^FOREIGN\s+TABLE$/i.test(kind)) return "f";
  if (/^VIEW$/i.test(kind)) return "v";
  return "r";
}

function parseRelationStatement(statement) {
  const header = statement.match(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:UNLOGGED\s+)?(MATERIALIZED\s+VIEW|FOREIGN\s+TABLE|TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?/i);
  if (!header) return null;
  const name = parseQualifiedIdentifier(statement, header[0].length);
  if (!name) return null;
  const tail = statement.slice(name.next);
  if (/^(?:VIEW|MATERIALIZED\s+VIEW)$/i.test(header[1])) {
    const asIndex = tail.search(/\bAS\b/i);
    if (asIndex === -1 || !tail.slice(asIndex + 2).trim()) return null;
    return { name: name.value, kind: relationKind(header[1]), body: null };
  }
  const opening = tail.indexOf("(");
  if (opening === -1) return null;
  const body = findBalancedParentheses(tail, opening);
  if (!body) return null;
  return { name: name.value, kind: relationKind(header[1]), body: body.body };
}

function parseFunctionStatement(statement) {
  const header = statement.match(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+/i);
  if (!header) return null;
  const name = parseQualifiedIdentifier(statement, header[0].length);
  if (!name) return null;
  const opening = statement.indexOf("(", name.next);
  const argumentsPart = opening === -1 ? null : findBalancedParentheses(statement, opening);
  if (!argumentsPart || !/^\s*RETURNS\b/i.test(statement.slice(argumentsPart.next))) return null;
  const parts = splitArguments(argumentsPart.body).map(argumentParts);
  const signature = {
    argumentNames: parts.map((item) => item.name),
    argumentTypes: parts.map((item) => item.type),
  };
  signature.key = signatureKey(name.value, signature.argumentTypes);
  return { name: name.value, signature };
}

export function schemaInventory(schemaSql) {
  const relations = new Set();
  const relationBodies = new Map();
  const relationKinds = new Map();
  const functions = new Map();
  const statements = splitSqlStatements(schemaSql);

  for (const statement of statements) {
    const relation = parseRelationStatement(statement);
    if (relation) {
      relations.add(relation.name);
      relationKinds.set(relation.name, relation.kind);
      if (relation.body !== null) relationBodies.set(relation.name, relation.body);
      continue;
    }
    const functionDefinition = parseFunctionStatement(statement);
    if (functionDefinition) {
      const signatures = functions.get(functionDefinition.name) ?? [];
      signatures.push(functionDefinition.signature);
      functions.set(functionDefinition.name, signatures);
    }
  }

  const signatureKeys = new Set([...functions.values()].flatMap((signatures) => signatures.map((signature) => signature.key)));
  return {
    source: "sql_dump_fallback",
    relations,
    relationBodies,
    relationKinds,
    functions,
    aclBySignature: parseAcl(statements, signatureKeys),
  };
}

function catalogBoolean(value, context) {
  if (typeof value !== "boolean") throw new Error(`invalid catalog boolean: ${context}`);
  return value;
}

export function catalogInventory(catalog) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.relations) || !Array.isArray(catalog.functions)) {
    throw new Error("invalid schema catalog format");
  }
  const relations = new Set();
  const relationBodies = new Map();
  const relationKinds = new Map();
  const functions = new Map();
  const aclBySignature = new Map();

  for (const relation of catalog.relations) {
    if (typeof relation?.schema !== "string" || typeof relation?.name !== "string" || typeof relation?.relkind !== "string") {
      throw new Error("invalid relation in schema catalog");
    }
    const name = normalizeIdentifier(`${relation.schema}.${relation.name}`);
    relations.add(name);
    relationKinds.set(name, relation.relkind);
    const columns = relation.columns ?? [];
    if (!Array.isArray(columns)) throw new Error(`invalid columns for ${name}`);
    relationBodies.set(name, columns
      .slice()
      .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
      .map((column) => `${normalizeIdentifier(column.name)} ${normalizeType(column.type)}`)
      .join("\n"));
  }

  for (const fn of catalog.functions) {
    if (typeof fn?.schema !== "string" || typeof fn?.name !== "string" || !Array.isArray(fn.arguments)) {
      throw new Error("invalid function in schema catalog");
    }
    const name = normalizeIdentifier(`${fn.schema}.${fn.name}`);
    const parts = fn.arguments.map((argument) => ({
      name: argument?.name === null || argument?.name === undefined ? null : normalizeIdentifier(argument.name),
      type: normalizeType(argument?.type ?? ""),
    }));
    if (parts.some((part) => !part.type)) throw new Error(`invalid function argument in schema catalog: ${name}`);
    const signature = {
      argumentNames: parts.map((part) => part.name),
      argumentTypes: parts.map((part) => part.type),
    };
    signature.key = signatureKey(name, signature.argumentTypes);
    const signatures = functions.get(name) ?? [];
    signatures.push(signature);
    functions.set(name, signatures);
    const executeAcl = fn.executeAcl;
    if (!executeAcl || typeof executeAcl !== "object") throw new Error(`missing execute ACL in schema catalog: ${name}`);
    const state = aclState();
    state.publicExecute = catalogBoolean(executeAcl.public, `${name}.public`);
    for (const role of ["anon", "authenticated", "service_role"]) {
      if (catalogBoolean(executeAcl[role], `${name}.${role}`)) state.grants.add(role);
    }
    aclBySignature.set(signature.key, state);
  }
  return { source: "catalog", relations, relationBodies, relationKinds, functions, aclBySignature };
}

function effectiveExecute(acl, role) {
  return acl.publicExecute || acl.grants.has(normalizeIdentifier(role));
}

function inventoryFor(sourceOrInventory) {
  if (typeof sourceOrInventory === "string") return schemaInventory(sourceOrInventory);
  if (sourceOrInventory?.source && sourceOrInventory.relations instanceof Set) return sourceOrInventory;
  return catalogInventory(sourceOrInventory);
}

export function findMissingContracts(sourceOrInventory, contracts) {
  const inventory = inventoryFor(sourceOrInventory);
  const missing = [];

  for (const contract of contracts) {
    const name = normalizeIdentifier(contract.name);
    if (contract.type === "relation") {
      if (!inventory.relations.has(name)) missing.push(`${contract.type}:${contract.name}`);
      continue;
    }
    if (contract.type === "column") {
      const relation = normalizeIdentifier(contract.relation);
      const body = inventory.relationBodies.get(relation);
      const columnPattern = new RegExp(`^\\s*"?${escapeRegExp(normalizeIdentifier(contract.name))}"?\\s+`, "im");
      if (!body || !columnPattern.test(body)) missing.push(`${contract.type}:${contract.relation}.${contract.name}`);
      continue;
    }
    if (contract.type === "function") {
      const signatures = inventory.functions.get(name) ?? [];
      const expectedArguments = contract.arguments?.map(normalizeIdentifier);
      const expectedTypes = contract.argumentTypes?.map(normalizeType);
      const matched = signatures.filter((signature) => {
        if (expectedArguments && (signature.argumentNames.length !== expectedArguments.length
            || !signature.argumentNames.every((argument, index) => argument === expectedArguments[index]))) return false;
        if (expectedTypes && (signature.argumentTypes.length !== expectedTypes.length
            || !signature.argumentTypes.every((argument, index) => argument === expectedTypes[index]))) return false;
        return true;
      });
      if (matched.length === 0) {
        const suffix = expectedArguments === undefined ? "" : `(${expectedArguments.join(",")})`;
        missing.push(`${contract.type}:${contract.name}${suffix}`);
        continue;
      }
      if (contract.allowOtherOverloads === false && signatures.length !== 1) {
        missing.push(`overload:${contract.name}:expected_exactly_one_found_${signatures.length}`);
      }
      if (contract.acl) {
        for (const signature of matched) {
          const acl = inventory.aclBySignature.get(signature.key) ?? aclState();
          for (const [role, expected] of Object.entries(contract.acl)) {
            const actual = effectiveExecute(acl, role);
            if (actual !== expected) {
              missing.push(`acl:${contract.name}(${signature.argumentTypes.join(",")}):${role}:expected_${expected ? "allow" : "deny"}`);
            }
          }
        }
      }
      continue;
    }
    missing.push(`unsupported:${contract.type ?? "unknown"}`);
  }

  return missing;
}

function staticDatabaseContracts(files, targetRoot, dependencyKind) {
  const relations = new Map();
  const functions = new Map();
  const addEvidence = (map, name, file) => {
    const evidenceFiles = map.get(name) ?? new Set();
    evidenceFiles.add(file);
    map.set(name, evidenceFiles);
  };
  for (const file of files) {
    const source = readFileSync(resolve(targetRoot, file), "utf8");
    for (const match of source.matchAll(/\.from\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
      const receiver = source.slice(0, match.index);
      if (/\.\s*storage\s*\??\s*$/.test(receiver)) continue;
      const schemaMatch = receiver.match(/\.schema\(\s*["'`]([^"'`]+)["'`]\s*\)\s*$/);
      const schema = schemaMatch ? schemaMatch[1].toLowerCase() : "public";
      addEvidence(relations, `${schema}.${match[1]}`, file);
    }
    for (const match of source.matchAll(/\.rpc\(\s*["'`]([^"'`]+)["'`]/g)) {
      addEvidence(functions, `public.${match[1]}`, file);
    }
    for (const match of source.matchAll(/dealerMassOpenRpc(?:<[^>]+>)?\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
      addEvidence(functions, `public.${match[1]}`, file);
    }
  }
  return [
    ...[...relations.entries()].map(([name, evidence]) => ({
      type: "relation", name, dependencyKind, evidenceFiles: [...evidence].sort(),
    })),
    ...[...functions.entries()].map(([name, evidence]) => ({
      type: "function", name, dependencyKind, evidenceFiles: [...evidence].sort(),
    })),
  ];
}

export function sourceContractsForFunction({ targetRoot, config }) {
  const entrypoint = resolve(targetRoot, config.path, "index.ts");
  const files = inspectImportGraph(entrypoint, targetRoot);
  return staticDatabaseContracts(files, targetRoot, "direct_imported_graph");
}

export function sourceContractsForFrontend({ targetRoot }) {
  const files = FRONTEND_CONTRACT_FILES.filter((file) => existsSync(resolve(targetRoot, file)));
  return mergeContracts(staticDatabaseContracts(files, targetRoot, "direct_frontend_source"),
    physicalAssetFrontendEnabled(targetRoot)?[PHYSICAL_ASSET_RPC_CONTRACT]:[],
    scopedStopFrontendEnabled(targetRoot)?[SCOPED_STOP_RPC_CONTRACT]:[],
    manualPlayerFrontendEnabled(targetRoot)?MANUAL_PLAYER_RPC_CONTRACTS:[],
    issuanceFrontendEnabled(targetRoot)?ISSUANCE_RPC_CONTRACTS:[]);
}

export function contractsForTargets({ manifest, rawTargets, targetRoot }) {
  const selection = selectTargetContractProfile({ targetRoot });
  const resolved = resolveTargetContracts(manifest, selection);
  if (rawTargets === "frontend") {
    return {
      selection,
      contracts: mergeContracts(sourceContractsForFrontend({ targetRoot }), resolved.frontend),
    };
  }
  const targets = parseTargetList(rawTargets);
  if (targets.length === 0) throw new Error("at least one probe target is required");
  const contracts = targets.flatMap((target) => {
    const config = manifest.functions[target];
    if (!config) throw new Error(`unknown deployment target: ${target}`);
    return mergeContracts(sourceContractsForFunction({ targetRoot, config }), resolved.functions[target]);
  });
  return { selection, contracts: mergeContracts(contracts) };
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const schemaPath = args.get("schema");
  const catalogPath = args.get("catalog");
  const rawTargets = args.get("targets");
  const targetRoot = args.get("target-root");
  if ((!schemaPath && !catalogPath) || (schemaPath && catalogPath) || !rawTargets || !targetRoot) {
    throw new Error("exactly one of schema or catalog, plus targets and target-root, is required");
  }

  const manifest = loadDeploymentManifest();
  const { selection, contracts } = contractsForTargets({ manifest, rawTargets, targetRoot });
  const inventory = schemaPath
    ? schemaInventory(readFileSync(schemaPath, "utf8"))
    : catalogInventory(JSON.parse(readFileSync(catalogPath, "utf8")));
  const missing = findMissingContracts(inventory, contracts);
  if (missing.length > 0) {
    console.error(`Live schema contract probe failed for ${selection.profile} from ${inventory.source}:`);
    for (const contract of [...new Set(missing)].sort()) console.error(`- ${contract}`);
    process.exitCode = 1;
    return;
  }
  if(rawTargets==="frontend") {
    const catalog=catalogPath?JSON.parse(readFileSync(catalogPath,"utf8")):undefined;
    assertPhysicalAssetFrontendBackend({targetRoot,catalog});
    assertScopedStopFrontendBackend({targetRoot,catalog});
    assertManualPlayerFrontendBackend({targetRoot,catalog});
    assertIssuanceFrontendBackend({targetRoot,catalog});
  }
  console.log(
    `Live schema contract probe passed for ${selection.profile} from ${inventory.source} (${contracts.length} checks, ${selection.sourceFingerprint}).`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
