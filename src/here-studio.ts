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
import * as fs from "fs"

import { createJoinSpace } from './here-xyz'

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

program
    .command("clone <project-id>")
    .alias("c")
    .description("Clone already published projects from Studio")
    .action(async function (id, options) {

        cloneProject (id, options)
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
        "d",// "Delete Project"
        "clone",
        "c"// "Delete Project"
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

async function execute(uri: string, method: string, contentType: string, data: any, token: string | null = null, gzip: boolean = false, setAuthorization: boolean = true) {
    if (!token) {
        token = await common.verify();
    }
    return await execInternal(uri, method, contentType, data, token, gzip, setAuthorization);
}

async function execInternal(
    uri: string,
    method: string,
    contentType: string,
    data: any,
    token: string,
    gzip: boolean,
    setAuthorization: boolean
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
    let headers = {
        "Authorization" : "Bearer " + token,
        "Content-Type": contentType,
        "App-Name": "HereCLI"
    }

    //Remove Auth params if not required, Used to get public response from URL
    if (setAuthorization == false) {
        delete headers["Authorization"]
    }

    const reqJson = {
        url: uri,
        method: method,
        json: isJson,
        headers,
        body: method === "GET" ? undefined : data
    };

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

//Will capture querystring parameters from URL
function getParameterByName (name: any, url: any) {
    if (!url) return null;
    name = name.replace(/[\[\]]/g, '\\$&');
    var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}



//cloneProject - cloning projects for studio
//
//- Get the token from ProjectAPI and have a reference of currentUser’s token
// https://xyz.api.here.com/project-api/projects/82764d11-e84a-40f6-b477-12d8041ccdb7
//
//     - Take the spaceIDs from ProjectAPI
// - Download / save response all features from the shared space from viewer url
// https://xyz.api.here.com/hub/spaces/mOXoWyWn/search?margin=20&clip=false&clientId=viewer&access_token=AFSmufxGTfOGWwZQF11aiwA&limit=100000
//     - Repeat downloading if multiple GeospaceIDs exists
//
// - Upload the file to new existing current user’s workspace
// - Create the project for existing user
// - Optionally - Copy layer styles that exists from older project
async function cloneProject  (id : any, options: any) {

    //Extract the ID if user has passed in the Viewer URL otherwise the input will be treated as id
    if (id.startsWith("http")) {
        id = getParameterByName("project_id", id)
    }

    //- Get the token from ProjectAPI and have a reference of currentUser’s token from below ProjectAPI GET URL // GET - https://xyz.api.here.com/project-api/projects/82764d11-e84a-40f6-b477-12d8041ccdb7  / // GET - https://studio.here.com/viewer/?project_id=3a02af56-aa75-400c-b886-36aa8d046c08 //id = "3a02af56-aa75-400c-b886-36aa8d046c08"/ b4d1126a-fc12-4406-b506-692ace752d52
    let uri = "/project-api/projects/"+id;
    console.log("Cloning project : "+id)
    let cType = "";

    let { response, body } = await execute(uri, "GET", cType, "", options.token, false, false);

    response.body = JSON.parse(response.body);
    //console.log(options)//
    // console.log("Response Body: ",response.body);

    //Fetch the current token from user's published project
    let publishersToken = response.body.rot;
    let currentUsersToken = await common.verify();
    // console.log("My Token : "+currentUsersToken)
    // console.log("Published Token : "+publishersToken)

    //Create a new project for currentUser copying all the response body of past users data //POST - ProjectsAPI with response.body of to-be cloned project
    uri = "/project-api/projects";
    cType = "application/json"

    //Remove id attribute before post call, the new project which will be created for current user with this data
    delete response.body.id;

    let clonedProjectData = response.body;

    //Get the GeoSpace-ID(s) of all the layers from published projects
    let updatedLayersData = await clonedProjectData.layers.map(async (currentLayer: any) => {

            let geoSpaceIDToCopy = currentLayer.geospace.id;
            console.log("Copying layer/space : '"+geoSpaceIDToCopy+"' from published project")

            //Download the GeospaceID from published project with the publisher's token -  Download the space from GET Search and save it in local temp file - https://xyz.api.here.com/hub/spaces/uLqEizJW/search
            uri = "/hub/spaces/"+geoSpaceIDToCopy+"/search";
            let { response:geoSpaceDataResponse, body:geoSpaceData } = await execute(uri, "GET", cType, clonedProjectData, publishersToken);

            //Check if GeoSpaceData is blank -> if yes move on to next one else create the file with that name
            if (geoSpaceData != "") {
                await fs.writeFileSync(geoSpaceIDToCopy+".geojson", JSON.stringify(geoSpaceData));
                console.log("GeoSpaceID locally copied: "+geoSpaceIDToCopy)

                //Copy the contents of the downloaded space to currentUser's XYZ spaces


            }

            //Upload it to current user's space

            //Update the geospace id for current layer

            //Clear cache and delete the file from temp repo


            return currentLayer;
    });

    Promise.all(updatedLayersData).then(() => {
        console.log("Will clone new project with : ",clonedProjectData)
    })



    //Create a new project under current user with the settings of published projects
    let { response:newProjectResponse, body:newProjectBody } = await execute(uri, "POST", cType, clonedProjectData, options.token);
    // console.log("New Project Created ", newProjectResponse)

    let studioBaseURL = "https://studio.here.com";
    let clonedProjectURL = studioBaseURL+"/studio/project/"+newProjectBody.id;
    if (newProjectResponse.statusCode == 201) {
        console.log("Project cloned in current user account, Goto URL : "+clonedProjectURL)
    }

}
