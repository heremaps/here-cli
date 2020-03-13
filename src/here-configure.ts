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
        type: "list",
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
        try{
            await common.resetTermsFlag();

            let cookieData = await common.hereAccountLogin(result['Email'], result['Password']);
            let appsData = await common.getAppIds(cookieData);
            appsData = JSON.parse(appsData);
            let hereAccountID = appsData.aid;
            let updateTC = false;
            let appIdAppCodeMap : any = {};
            if (appsData.apps) {
                let apps = appsData.apps;
                let defaultAppId = appsData.defaultAppId;
                updateTC = appsData.tcAcceptedAt == 0 ? true : false;
                for (let key in apps) {
                    let app = apps[key];
                    appIdAppCodeMap[app.dsAppId] = app.dsAppCode;
                    if(app.status.toLowerCase() == 'active'){
                        if (key == defaultAppId) {
                            choiceList.push({ name: app.dsAppId + " (Plan-" + app.dsPlanType + ")" + ' (DEFAULT)', value: app.dsAppId  });
                        } else {
                            choiceList.push({ name: app.dsAppId + " (Plan-" + app.dsPlanType + ")", value: app.dsAppId });
                        }
                    }
                }
            }
            if(choiceList.length > 0){
                let appId;
                if(choiceList.length === 1){
                    appId = choiceList[0].value;
                } else {
                    let appIdAnswers : any = await inquirer.prompt(questions);
                    appId = appIdAnswers.tagChoices;
                }
                let appCode = appIdAppCodeMap[appId];
                await common.updateDefaultAppId(cookieData, hereAccountID, appId, updateTC === false).catch(err => {throw err});
                await common.updatePlanDetails(appsData.apps);
                await common.generateToken(cookieData, appId).catch(err => {throw err});
                await common.encryptAndStore('appDetails', appId + common.keySeparator + appCode).catch(err => {throw err});
                await common.encryptAndStore('apiKeys', appId).catch(err => {throw err});
                console.log('Default App Selected - ' + appId);
            }else{
                console.log('No Active Apps found. Please login to https://developer.here.com for more details.');
            }
        }catch(error){
            console.log(error.message);
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


program
    .command('refresh')
    .description('Refresh account setup')
    .action(function (options:any) {
        common.refreshAccount();
    });




prompter.stop();

program.parse(process.argv);

if (!program.args.length) {
    setUserPass();
} else {
    common.validate(["help","set","verify","account","refresh"], [process.argv[2]], program);
}

process.on('uncaughtException', error => {
    console.log(error.message);
});