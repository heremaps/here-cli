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

import * as _ from "lodash";
import * as common from "./common";
import {requestAsync} from "./requestAsync";
import {ApiError} from "./api-error";
import * as zlib from "zlib";
import * as program from "commander";

program
    .command("list")
    .alias("ls")
    .description("information about available XYZ Studio Projects")
    .action(async function (options) {
        listProjects(options)
            .catch((error) => {
                handleError(error);
            })
    });

program
    .command("show <project-id>")
    .alias("s")
    .description("Open published projects in viewer")
    .action(async function (id, options) {
        showProject (id, options)
            .catch((error) => {
                handleError(error);
            })
    });

program
    .command("delete <project-id>")
    .alias("d")
    .description("Delete projects from XYZ Studio")
    .action(async function (id, options) {
        deleteProject (id, options)
            .catch((error) => {
                handleError(error);
            })
    });

common.validate(
    [
        "list", // List project URL
        "ls",
        "show", //Open the project URL
        "s",
        "delete",
        "d"// "Delete Project"
    ],
    [process.argv[2]],
    program
);
program.parse(process.argv);

/**
 *
 * @param apiError error object
 * @param isIdSpaceId set this boolean flag as true if you want to give space specific message in console for 404
 */
function handleError(apiError: ApiError, isIdSpaceId: boolean = false) {
    if (apiError.statusCode) {
        if (apiError.statusCode == 401) {
            console.log("Operation FAILED : Unauthorized, if the problem persists, please reconfigure account with `here configure` command");
        } else if (apiError.statusCode == 403) {
            console.log("Operation FAILED : Insufficient rights to perform action");
        } else if (apiError.statusCode == 404) {
            if (isIdSpaceId) {
                console.log("Operation FAILED: Space does not exist");
            } else {
                console.log("Operation FAILED : Resource not found.");
            }
        } else {
            console.log("OPERATION FAILED : " + apiError.message);
        }
    } else {
        if (apiError.message && apiError.message.indexOf("Insufficient rights.") != -1) {
            console.log("Operation FAILED - Insufficient Rights to perform action");
        } else {
            console.log("OPERATION FAILED - " + apiError.message);
        }
    }
}

async function execute(uri: string, method: string, contentType: string, data: any, token: string | null = null, gzip: boolean = false) {
    if (!token) {
        token = await common.verify();
    }
    return await execInternal(uri, method, contentType, data, token, gzip);
}

async function execInternal(
    uri: string,
    method: string,
    contentType: string,
    data: any,
    token: string,
    gzip: boolean
) {
    if (gzip) {
        return await execInternalGzip(
            uri,
            method,
            contentType,
            data,
            token
        );
    }
    if (!uri.startsWith("http")) {
        uri = common.xyzRoot() + uri;
    }
    const isJson = contentType == "application/json" ? true : false;
    const headers = {
        Authorization: "Bearer " + token,
        "Content-Type": contentType,
        "App-Name": "HereCLI"
    }
    const reqJson = {
        url: uri,
        method: method,
        json: isJson,
        headers,
        body: method === "GET" ? undefined : data
    };
    //console.log(reqJson)

    const { response, body } = await requestAsync(reqJson);
    if (response.statusCode < 200 || response.statusCode > 210) {
        let message = (response.body && response.body.constructor != String) ? JSON.stringify(response.body) : response.body;
        //throw new Error("Invalid response - " + message);
        throw new ApiError(response.statusCode, message);
    }
    return { response, body };
}

function gzip(data: zlib.InputType): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) =>
        zlib.gzip(data, (error, result) => {
            if (error)
                reject(error)
            else
                resolve(result);
        })
    );
}

async function execInternalGzip(
    uri: string,
    method: string,
    contentType: string,
    data: any,
    token: string,
    retry: number = 3
) {
    const zippedData = await gzip(data);
    const isJson = contentType == "application/json" ? true : false;
    if (!uri.startsWith("http")) {
        uri = common.xyzRoot() + uri;
    }
    const reqJson = {
        url: uri,
        method,
        json: isJson,
        headers: {
            Authorization: "Bearer " + token,
            "Content-Type": contentType,
            "Content-Encoding": "gzip",
            "Accept-Encoding": "gzip"
        },
        gzip: true,
        body: method === "GET" ? undefined : zippedData
    };

    let { response, body } = await requestAsync(reqJson);
    if (response.statusCode < 200 || response.statusCode > 210) {
        if (response.statusCode >= 500 && retry > 0) {
            await new Promise(done => setTimeout(done, 1000));
            body = await execInternalGzip(uri, method, contentType, data, token, --retry);
        } else {
            //   throw new Error("Invalid response :" + response.statusCode);
            throw new ApiError(response.statusCode, response.body);
        }
    }
    return { response, body };
}


/**
 * Will list all the projects for the given user in below format
 *
 * @param options
 */
async function listProjects (options: any) {
    console.log("Please wait; Fetching your list of projects...")
    const uri = "/project-api/projects";
    const cType = "";//"application/json";//
    let { response, body } = await execute(uri, "GET", cType, "", options.token);
    if (body.length == 0) {
        console.log("No xyz projects found");
    } else {
        let fields = ["id", "title", "status"];

        body = JSON.parse(body);

        //Flattened array of project JsonObjects containing info about name, id and description, add any other info later as necessary
        let extractProjectInfo: any[] = new Array();

        //Iterate through all the projects and extract meta information in extractColumns Array having JSON Objects with keys of id, name and description,
        _.forEach(body, (currentProject: { status: string; id: string; meta: { name: any; description: any; }; }) => {

            //Check whether meta info like project description and name exists for that project? - > If exists Push the meta info with id in new
            if (_.has(currentProject, 'meta')) {
                let viewerURL = "";
                if (currentProject.status.toUpperCase() === "PUBLISHED") {
                    viewerURL = "https://xyz.here.com/viewer/?project_id=" + currentProject.id;
                }
                let currentProjectDetails = {
                    id: currentProject.id,
                    title: currentProject.meta.name,
                    description: currentProject.meta.description,
                    status: currentProject.status,
                    viewerURL
                }
                extractProjectInfo.push(new Object(currentProjectDetails))
            }
        })

        //List the project
        common.drawNewTable(extractProjectInfo, fields, [40, 25, 12]);
    }
}

async function showProject (id : any, options: any) {
    const opn = require("opn");
    opn(
        "https://xyz.here.com/viewer/?project_id="+id
        , { wait: false });
}

async function deleteProject  (id : any, options: any) {
    console.log("Deleting project : "+id)

    //If project exists send a DELETE request for that projectID
    const uri = "/project-api/projects/"+id;
    const cType = "";
    let { response, body } = await execute(uri, "DELETE", cType, "", options.token);

    if (response && response.statusCode === 204) {
        console.log("Successfully deleted project.")
    }
    else {
        console.log("Unable to delete project having project-id: "+id)
    }
}
