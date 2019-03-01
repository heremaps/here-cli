#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const program = require("commander");
const common = require("./common");
const prompter = require('prompt');
program
    .version('0.1.0');
program
    .command('set')
    .arguments('[env]')
    .description('configure HERE credentials for authentiction')
    .action(function (env, options) {
    setAuth(env);
});
function setAuth(env) {
    prompter.start();
    prompter.get([{
            name: 'AppId',
            required: true
        }, {
            name: 'AppCode',
            hidden: true,
            conform: () => true
        }], function (err, result) {
        common.login(result['AppId'], result['AppCode']).catch(err => console.error(err));
    });
}
program
    .command('account')
    .description('configure HERE account email/password for authentiction. Account can be created from https://developer.here.com/')
    .action(function (env, options) {
    setUserPass(env);
});
function setUserPass(env) {
    prompter.start();
    prompter.get([{
            name: 'Email',
            required: true
        }, {
            name: 'Password',
            hidden: true,
            conform: () => true
        }], function (err, result) {
        common.hereAccountLogin(result['Email'], result['Password']);
    });
}
program
    .command('verify')
    .arguments('[env]')
    .description('Verify credentials')
    .action(function (env, options) {
    common.verify();
});
prompter.stop();
program.parse(process.argv);
if (!program.args.length) {
    setAuth();
}
else {
    common.validate(["help", "set", "verify", "account"], [process.argv[2]], program);
}
