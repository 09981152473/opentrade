'use strict';

const url = require('url');

const utils = require("../../utils.js");
const g_constants = require("../../constants.js");

const mailer = require("./mailer.js");

let emailChecker = {};

exports.onSubmit = function(req, res)
{
    const request = req;
    const responce = res;
    
    utils.validateRecaptcha(request, ret => {
        if (ret.error)
        {
            SignupError(request, responce, ret.message);
            return;
        }
        validateForm(ret => {
            if (ret.error)
            {
                SignupError(request, responce, ret.message);
                return;
            }
            CheckUserExist(request, responce);
        });
    });
    
    function validateForm(req, callback)
    {
        if (!req.body || !req.body['username'] || !req.body['email'] || !req.body['password1'] || !req.body['password2'])
        {
            callback({error: true, message: 'Bad Request'});
            return;
        }
        
        if (req.body['password1'] != req.body['password2'])
        {
            callback({error: true, message: 'The two password fields didn\'t match.'});
            return;
        }
        
        if (!utils.ValidateEmail(req.body['email']))
        {
            callback({error: true, message: 'Ivalid email'});
            return;
        }
        callback({error: false, message: ''});
    }
    
    function CheckUserExist(req, res)
    {
        const user = req.body['username'];
        const email = req.body['email'];
        IsUserExist(user, function(exist) {
            if (exist)
            {
                SignupError(req, res, {error: true, message: 'Sorry. This user already registered'});
                return;
            }
                
            IsEmailExist(email, function(exist){
                if (exist)
                {
                    SignupError(req, res, {error: true, message: 'Sorry. This user already registered'});;
                    return;
                }
                SendConfirmEmail(req, res);
            });
        });
    }

    function SendConfirmEmail(req, res)
    {
        const strCheck = escape(utils.Hash(req.body['email']+Date.now()+Math.random()));
        emailChecker[strCheck] = {body: req.body, time: Date.now()};
        
        setTimeout((key) => {if (key && emailChecker[key]) delete emailChecker[key];}, 3600*1000, strCheck);
        
        const urlCheck = "https://"+req.headers.host+"/checkmail/"+strCheck;
        mailer.SendSignupConfirmation(req.body['email'], "https://"+req.headers.host, urlCheck, ret => {
            if (ret.error)
            {
                SignupError(req, res, ret.message);
                return;
            }
            SignupSuccess(req, res, {});
        });
    }
}

exports.onCheckEmail = function(req, res)
{
    const strCheck = req.url.substr(req.url.indexOf('/', 1)+1);
    
    console.log(strCheck);
    console.log(JSON.stringify(emailChecker));
    
    if (!emailChecker[strCheck] || !emailChecker[strCheck].body)
    {
        utils.render(res, 'pages/registration/signup_confirm', {error: true, message: 'Invalid confirmation link.'})
        return;
    }
    
    req['body'] = emailChecker[strCheck].body;
    Signup(req, res);
}

function Signup(req, res)
{
    const user = req.body['username'];
    const email = req.body['email'];
    const password = utils.Hash(req.body['password1'] + g_constants.password_private_suffix);
    
    IsUserExist(user, function(exist) {
        if (exist)
        {
            SignupError(req, res, {error: true, message: 'Sorry. This user already registered'});
            return;
        }
        
        IsEmailExist(email, function(exist){
            if (exist)
            {
                SignupError(req, res, {error: true, message: 'Sorry. This user already registered'});;
                return;
            }
            InsertNewUser(user, email, password, res);
        });
    });
}

function IsUserExist(user, callback)
{
    g_constants.dbTables['users'].selectAll("login", "login='"+escape(user)+"'", "", function(error, rows) {
        if (rows && rows.length)
        {
            callback(true);
            return;
        }
        callback(false);
    });
}

function IsEmailExist(email, callback)
{
    g_constants.dbTables['users'].selectAll("login", "email='"+escape(email)+"'", "", function(error, rows) {
        if (rows && rows.length)
        {
            callback(true);
            return;
        }
        callback(false);
    });
}

function InsertNewUser(user, email, password, res)
{
    const info = JSON.stringify({});
    g_constants.dbTables['users'].insert(user, email, password, info, function(err) {
        if (err)
        {
            utils.render(res, 'pages/registration/signup_confirm', {error: true, message: 'Something wrong (( Please try again.'});
            return;
        }
    });
    utils.render(res, 'pages/registration/signup_confirm', {error: false, message: 'Success. Registration confirmed!'});
}

function SignupSuccess(request, responce, message)
{
    utils.renderJSON(request, responce, {result: true, message: message});
}

function SignupError(request, responce, message)
{
    utils.renderJSON(responce, {result: false, message: message});
}