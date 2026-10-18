#!/usr/bin/env node
import './confine.js';
import { runBackupCli } from './cli.js';

process.exitCode = await runBackupCli(process.argv.slice(2), process.env);
