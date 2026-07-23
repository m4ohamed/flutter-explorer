"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const dartParser_js_1 = require("../src/indexer/dartParser.js");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const parser = new dartParser_js_1.DartParser();
const projectDir = 'f:/flutter_course_platform/lib';
function getFiles(dir) {
    const subdirs = fs.readdirSync(dir);
    const files = [];
    for (const subdir of subdirs) {
        const res = path.join(dir, subdir);
        if (fs.statSync(res).isDirectory()) {
            files.push(...getFiles(res));
        }
        else if (res.endsWith('.dart')) {
            files.push(res);
        }
    }
    return files;
}
const files = getFiles(projectDir);
let totalClasses = 0;
let totalMethods = 0;
let totalTopFuncs = 0;
let totalVariables = 0;
console.log(`Analyzing ${files.length} files...`);
for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const result = parser.parse(file, content);
    totalClasses += result.classes.length;
    totalMethods += result.classes.reduce((sum, c) => sum + c.methods.length, 0);
    totalTopFuncs += result.functions.length;
    totalVariables += result.variables.length;
}
console.log('--- SUMMARY RESULTS ---');
console.log(`Analyzed Files        : ${files.length}`);
console.log(`Total Classes         : ${totalClasses}`);
console.log(`Total Methods         : ${totalMethods}`);
console.log(`Total Top-level Funcs : ${totalTopFuncs}`);
console.log(`Total Variables       : ${totalVariables}`);
