#!/usr/bin/env node

/*
  Copyright (C) 2018 - 2019 HERE Europe B.V.
  SPDX-License-Identifier: MIT

  Permission is hereby granted, free of charge, to any person obtaining
  a copy of this software and associated documentation files (the
  'Software'), to deal in the Software without restriction, including
  without limitation the rights to use, copy, modify, merge, publish,
  distribute, sublicense, and/or sell copies of the Software, and to
  permit persons to whom the Software is furnished to do so, subject to
  the following conditions:

  The above copyright notice and this permission notice shall be
  included in all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import program = require('commander');
import common = require('./common');
import * as inquirer from "inquirer";

const prompter = require('prompt');

let choiceList: { name: string, value: string}[] = [];
const questions = [
    {
        type: "rawlist",
        name: "tagChoices",
        message: "Select default AppId.",
        choices: choiceList
    }
];
program
    .version('0.1.0');

program
    .command('set')
    .arguments('[env]')
    .description('configure HERE credentials for authentiction')
    .action(function(env, options) {
        setUserPass(env);
    });

function setAuth(env?: any) {
    prompter.start();
    prompter.get([{
        name: 'AppId',
        required: true
    }, {
        name: 'AppCode',
        hidden: true,
        conform: () => true
    }], function (err: any, result: any) {
        common.login(result['AppId'], result['AppCode']).catch(err => console.error(err));
    });
}

program
    .command('account')
    .description('configure HERE account email/password for authentiction. Account can be created from https://developer.here.com/')
    .action(function (env, options) {
        setUserPass(env);
    });

async function setUserPass(env?: any) {
    prompter.start();
    prompter.get([{
        name: 'Email',
        required: true
    }, {
        name: 'Password',
        hidden: true,
        conform: () => true
    }], async function (err: any, result: any) {
        let cookieData = await common.hereAccountLogin(result['Email'], result['Password']);
        let appsData = await common.getAppIds(cookieData);
        appsData = JSON.parse(appsData);
        let hereAccountID = appsData.aid;
        let updateTC = false;
        if (appsData.apps) {
            let apps = appsData.apps;
            let defaultAppId = appsData.defaultAppId;
            updateTC = appsData.tcAcceptedAt == 0 ? true : false;

            for (let key in apps) {
                let app = apps[key];
                if(app.status.toLowerCase() == 'active'){
                    if (key == defaultAppId) {
                        choiceList.push({ name: app.dsAppId + ' (DEFAULT)', value: app.dsAppId });
                    } else {
                        choiceList.push({ name: app.dsAppId, value: app.dsAppId });
                    }
                }
            }
        }
        if(choiceList.length > 0){
            inquirer.prompt(questions).then(async (answers: any) => {
                await common.updateDefaultAppId(cookieData, hereAccountID, answers.tagChoices, updateTC === true);
                await common.generateToken(cookieData, answers.tagChoices);
            });        
        }else{
            console.log('No Active Apps found. Please login to https://developer.here.com for more details.');
        }
        
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
    setUserPass();
} else {
    common.validate(["help","set","verify","account"], [process.argv[2]], program);
}
