'use strict';

const utils = require("../../utils.js");
const g_constants = require("../../constants.js");

exports.onPassworReset = function(req, res)
{
    const responce = res;
    const request = req;
    utils.validateRecaptcha(req, ret => {
        if (ret.error)
        {
            PasswordResetError(request, responce, ret.message);
            return;
        }
        validateForm(req, ret => {
            if (ret.error)
            {
                PasswordResetError(request, responce, ret.message);
                return;
            }
            PasswordReset(req, res);
        });
    });
}

function validateForm(request, callback)
{
    if (!request.body || request.body['email'])
    {
        callback({error: true, message: 'Bad Request'});
        return;
    }
    callback({error: false, message: ''});
}


function PasswordReset(req, res)
{
    PasswordResetSuccess(req, res, {});
}

function PasswordResetSuccess(request, responce, message)
{
    utils.renderJSON(request, responce, {result: true, message: message});
}

function PasswordResetError(request, responce, message)
{
    utils.renderJSON(responce, {result: false, message: message});
}