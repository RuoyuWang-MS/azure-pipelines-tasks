import Q = require('q');
import tl = require('azure-pipelines-task-lib/task');
import trm = require('azure-pipelines-task-lib/toolrunner');
import fs = require('fs');
import path = require('path');
import { Package, PackageType } from './packageUtility';

var winreg = require('winreg');
var parseString = require('xml2js').parseString;
const ERROR_FILE_NAME = "error.txt";

/**
 * Constructs argument for MSDeploy command
 * 
 * @param   webAppPackage                   Web deploy package
 * @param   webAppName                      web App Name
 * @param   publishingProfile               Azure RM Connection Details
 * @param   removeAdditionalFilesFlag       Flag to set DoNotDeleteRule rule
 * @param   excludeFilesFromAppDataFlag     Flag to prevent App Data from publishing
 * @param   takeAppOfflineFlag              Flag to enable AppOffline rule
 * @param   virtualApplication              Virtual Application Name
 * @param   setParametersFile               Set Parameter File path
 * @param   additionalArguments             Arguments provided by user
 * @param   isParamFilePresentInPacakge     Flag to check Paramter.xml file
 * @param   isFolderBasedDeployment         Flag to check if given web package path is a folder
 * 
 * @returns string 
 */
export function getMSDeployCmdArgs(webAppPackage: string, webAppName: string, publishingProfile,
                             removeAdditionalFilesFlag: boolean, excludeFilesFromAppDataFlag: boolean, takeAppOfflineFlag: boolean,
                             virtualApplication: string, setParametersFile: string, additionalArguments: string, isParamFilePresentInPacakge: boolean,
                             isFolderBasedDeployment: boolean, useWebDeploy: boolean) : string {

    var msDeployCmdArgs: string = " -verb:sync";

    var webApplicationDeploymentPath = (virtualApplication) ? webAppName + "/" + virtualApplication : webAppName;
    
    if(isFolderBasedDeployment) {
        msDeployCmdArgs += " -source:IisApp=\"'" + webAppPackage + "'\"";
        msDeployCmdArgs += " -dest:iisApp=\"'" + webApplicationDeploymentPath + "'\"";
    }
    else {
        if (webAppPackage && webAppPackage.toLowerCase().endsWith('.war')) {
            tl.debug('WAR: webAppPackage = ' + webAppPackage);
            let warFile = path.basename(webAppPackage.slice(0, webAppPackage.length - '.war'.length));
            let warExt = webAppPackage.slice(webAppPackage.length - '.war'.length)
            tl.debug('WAR: warFile = ' + warFile);
            warFile = (virtualApplication) ? warFile + "/" + virtualApplication + warExt : warFile + warExt;
            tl.debug('WAR: warFile = ' + warFile);
            msDeployCmdArgs += " -source:contentPath=\"'" + webAppPackage + "'\"";
            // tomcat, jetty location on server => /site/webapps/
            tl.debug('WAR: dest = /site/webapps/' + warFile);
            msDeployCmdArgs += " -dest:contentPath=\"'/site/webapps/" + warFile + "'\"";
        } else {
            msDeployCmdArgs += " -source:package=\"'" + webAppPackage + "'\"";

            if(isParamFilePresentInPacakge) {
                msDeployCmdArgs += " -dest:auto";
            }
            else {
                msDeployCmdArgs += " -dest:contentPath=\"'" + webApplicationDeploymentPath + "'\"";
            }
        }
    }

    if(publishingProfile != null) {
        msDeployCmdArgs += ",ComputerName=\"'https://" + publishingProfile.publishUrl + "/msdeploy.axd?site=" + webAppName + "'\",";
        msDeployCmdArgs += "UserName=\"'" + publishingProfile.userName + "'\",Password=\"'" + publishingProfile.userPWD + "'\",AuthType=\"'Basic'\"";
    }
    
    if(isParamFilePresentInPacakge) {
        msDeployCmdArgs += " -setParam:name=\"'IIS Web Application Name'\",value=\"'" + webApplicationDeploymentPath + "'\"";
    }

    if(takeAppOfflineFlag) {
        msDeployCmdArgs += ' -enableRule:AppOffline';
    }

    if(useWebDeploy) {
        if(setParametersFile) {
            msDeployCmdArgs += " -setParamFile=" + setParametersFile + " ";
        }

        if(excludeFilesFromAppDataFlag) {
            msDeployCmdArgs += ' -skip:Directory=App_Data';
        }
    }

    additionalArguments = additionalArguments ? escapeQuotes(additionalArguments) : ' ';
    msDeployCmdArgs += ' ' + additionalArguments;

    if(!(removeAdditionalFilesFlag && useWebDeploy)) {
        msDeployCmdArgs += " -enableRule:DoNotDeleteRule";
    }

    if(publishingProfile != null)
    {
        var userAgent = tl.getVariable("AZURE_HTTP_USER_AGENT");
        if(userAgent)
        {
            msDeployCmdArgs += ' -userAgent:' + userAgent;
        }
    }

    tl.debug('Constructed msDeploy comamnd line arguments');
    return msDeployCmdArgs;
}


/**
 * Escapes quotes in a string to ensure proper command-line parsing.
 * @param {string} additionalArguments - The string to format.
 * @returns {string} The formatted string with escaped quotes.
 */
function escapeQuotes(additionalArguments: string): string {
    const parsedArgs = parseAdditionalArguments(additionalArguments);
    const separator = ",";

    const formattedArgs = parsedArgs.map(function (arg) {
        let formattedArg = '';
        let equalsSignEncountered = false;
        for (let i = 0; i < arg.length; i++) {
            const char = arg.charAt(i);
            if (char == separator && equalsSignEncountered) {
                equalsSignEncountered = false;
                arg = arg.replace(formattedArg, escapeArg(formattedArg));
                formattedArg = '';
                continue;
            }
            if (equalsSignEncountered) {
                formattedArg += char;
            } 
            if (char == '=') {
                equalsSignEncountered = true;
            } 
        };

        if (formattedArg.length > 0) {
            arg = arg.replace(formattedArg, escapeArg(formattedArg));
        }

        return arg;
    });

    return formattedArgs.join(' ');
}
exports.escapeQuotes = escapeQuotes;

/**
 * Escapes special characters in a string to ensure proper command-line parsing.
 * @param {string} arg - The string to format.
 * @returns {string} The formatted string with escaped characters.
 */
function escapeArg(arg: string): string {
    var escapedChars = new RegExp(/[\\\^\.\*\?\-\&\|\(\)\<\>\t\n\r\f]/);
    // If the argument starts with dowble quote and ends with double quote, the replace it with escaped double quotes
    if (arg.startsWith('"') && arg.endsWith('"')) {
        return '"\\' + arg.slice(0, arg.length - 1) + '\\""';
    }
    // If the argument starts with single quote and ends with single quote, then replace it with escaped double qoutes
    if (arg.startsWith("'") && arg.endsWith("'")) {
        return '"\\"' + arg.slice(1, arg.length - 1) + '\\""';
    }

    if (escapedChars.test(arg)) {
        return '"\\"' + arg + '\\""';
    }
    return arg;
}

/**
 * Parses additional arguments for the msdeploy command-line utility.
 * @param {string} additionalArguments - The additional arguments to parse.
 * @returns {string[]} An array of parsed arguments.
 */
function parseAdditionalArguments(additionalArguments: string): string[] {
    var parsedArgs = [];
    var isInsideQuotes = false;
    for (let i = 0; i < additionalArguments.length; i++) {
        var arg = '';
        var qouteSymbol = '';
        let char = additionalArguments.charAt(i);
        // command parse start
        if (char === '-') {
            while (i < additionalArguments.length) {
                char = additionalArguments.charAt(i);
                const prevSym = additionalArguments.charAt(i - 1);
                // If we reach space and we are not inside quotes, then it is the end of the argument
                if (char === ' ' && !isInsideQuotes) break;
                // If we reach unescaped comma and we inside qoutes we assume that it is the end of quoted line
                if (isInsideQuotes && char === qouteSymbol &&  prevSym !== '\\') {
                    isInsideQuotes = false;
                    qouteSymbol = '';
                // If we reach unescaped comma and we are not inside qoutes we assume that it is the beggining of quoted line
                } else if (!isInsideQuotes && (char === '"' || char === "'") &&  prevSym !== '\\') {
                    isInsideQuotes = !isInsideQuotes;
                    qouteSymbol = char;
                }

                arg += char;
                i += 1;
            }
            parsedArgs.push(arg);
        }
    }
    return parsedArgs;
}

export async function getWebDeployArgumentsString(webDeployArguments: WebDeployArguments, publishingProfile: any) {
    return getMSDeployCmdArgs(webDeployArguments.package.getPath(), webDeployArguments.appName, publishingProfile, webDeployArguments.removeAdditionalFilesFlag,
    webDeployArguments.excludeFilesFromAppDataFlag, webDeployArguments.takeAppOfflineFlag, webDeployArguments.virtualApplication, 
    webDeployArguments.setParametersFile, webDeployArguments.additionalArguments, await webDeployArguments.package.isMSBuildPackage(), webDeployArguments.package.isFolder(), webDeployArguments.useWebDeploy);
}

/**
 * Gets the full path of MSDeploy.exe
 * 
 * @returns    string
 */
export async function getMSDeployFullPath() {
    try {
        var msDeployInstallPathRegKey = "\\SOFTWARE\\Microsoft\\IIS Extensions\\MSDeploy";
        var msDeployLatestPathRegKey = await getMSDeployLatestRegKey(msDeployInstallPathRegKey);
        var msDeployFullPath = await getMSDeployInstallPath(msDeployLatestPathRegKey);
        msDeployFullPath = msDeployFullPath + "msdeploy.exe";
        return msDeployFullPath;
    }
    catch(error) {
        tl.debug(error);
        return path.join(__dirname, "MSDeploy3.6", "msdeploy.exe"); 
    }
}

function getMSDeployLatestRegKey(registryKey: string): Q.Promise<string> {
    var defer = Q.defer<string>();
    var regKey = new winreg({
      hive: winreg.HKLM,
      key:  registryKey
    })

    regKey.keys(function(err, subRegKeys) {
        if(err) {
            defer.reject(tl.loc("UnabletofindthelocationofMSDeployfromregistryonmachineError", err));
        }
        var latestKeyVersion = 0 ;
        var latestSubKey;
        for(var index in subRegKeys) {
            var subRegKey = subRegKeys[index].key;
            var subKeyVersion = subRegKey.substr(subRegKey.lastIndexOf('\\') + 1, subRegKey.length - 1);
            if(!isNaN(subKeyVersion)){
                var subKeyVersionNumber = parseFloat(subKeyVersion);
                if(subKeyVersionNumber > latestKeyVersion) {
                    latestKeyVersion = subKeyVersionNumber;
                    latestSubKey = subRegKey;
                }
            }
        }
        if(latestKeyVersion < 3) {
            defer.reject(tl.loc("UnsupportedinstalledversionfoundforMSDeployversionshouldbeatleast3orabove", latestKeyVersion));
        }
         defer.resolve(latestSubKey);
    });
    return defer.promise;
}

function getMSDeployInstallPath(registryKey: string): Q.Promise<string> {
    var defer = Q.defer<string>();

    var regKey = new winreg({
      hive: winreg.HKLM,
      key:  registryKey
    })

    regKey.get("InstallPath", function(err,item) {
        if(err) {
            defer.reject(tl.loc("UnabletofindthelocationofMSDeployfromregistryonmachineError", err));
        }
        defer.resolve(item.value);
    });

    return defer.promise;
}

/**
 * 1. Checks if msdeploy during execution redirected any error to 
 * error stream ( saved in error.txt) , display error to console
 * 2. Checks if there is file in use error , suggest to try app offline.
 */
export function redirectMSDeployErrorToConsole() {
    var msDeployErrorFilePath = tl.getVariable('System.DefaultWorkingDirectory') + '\\' + ERROR_FILE_NAME;
    
    if(tl.exist(msDeployErrorFilePath)) {
        var errorFileContent = fs.readFileSync(msDeployErrorFilePath).toString();

        if(errorFileContent !== "") {
            if(errorFileContent.indexOf("ERROR_INSUFFICIENT_ACCESS_TO_SITE_FOLDER") !== -1) {
                tl.warning(tl.loc("Trytodeploywebappagainwithappofflineoptionselected"));
            }
            else if(errorFileContent.indexOf("An error was encountered when processing operation 'Delete Directory' on 'D:\\home\\site\\wwwroot\\app_data\\jobs'") !== -1) {
                tl.warning(tl.loc('WebJobsInProgressIssue'));
            }
            else if(errorFileContent.indexOf("FILE_IN_USE") !== -1) {
                tl.warning(tl.loc("Trytodeploywebappagainwithrenamefileoptionselected"));
            }
            else if(errorFileContent.indexOf("transport connection") != -1){
                errorFileContent = errorFileContent + tl.loc("Updatemachinetoenablesecuretlsprotocol");
            }
          
            tl.error(errorFileContent);
        }

        tl.rmRF(msDeployErrorFilePath);
    }
}

export function getWebDeployErrorCode(errorMessage): string {
    if(errorMessage !== "") {
        if(errorMessage.indexOf("ERROR_INSUFFICIENT_ACCESS_TO_SITE_FOLDER") !== -1) {
            return "ERROR_INSUFFICIENT_ACCESS_TO_SITE_FOLDER";
        }
        else if(errorMessage.indexOf("An error was encountered when processing operation 'Delete Directory' on 'D:\\home\\site\\wwwroot\\app_data\\jobs") !== -1) {
            return "WebJobsInProgressIssue";
        }
        else if(errorMessage.indexOf("FILE_IN_USE") !== -1) {
            return "FILE_IN_USE";
        }
        else if(errorMessage.indexOf("transport connection") != -1){
            return "transport connection";
        }
        else if(errorMessage.indexOf("ERROR_CONNECTION_TERMINATED") != -1) {
            return "ERROR_CONNECTION_TERMINATED"
        }
        else if(errorMessage.indexOf("ERROR_CERTIFICATE_VALIDATION_FAILED") != -1) {
            return "ERROR_CERTIFICATE_VALIDATION_FAILED";
        }
    }

    return "";
}

export interface WebDeployArguments {
    package: Package;
    appName: string;
    publishUrl?: string;
    userName?: string;
    password?: string;
    removeAdditionalFilesFlag?: boolean;
    excludeFilesFromAppDataFlag?: boolean;
    takeAppOfflineFlag?: boolean;
    virtualApplication?: string;
    setParametersFile?: string
    additionalArguments?: string;
    useWebDeploy?: boolean;
}


export interface WebDeployResult {
    isSuccess: boolean;
    errorCode?: string;
    error?: string;
}