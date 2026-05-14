# SPRINT 2 - BUSINESS REQUESTS

We have met and showed the tool to some stake-holders prior to release and they have requested the following changes:

## PRICING

Price is now set to 9.99€ if bough in < 30 days and then 30€ , these are the changes needed to be implemented:
Price should be yearly, so change the values to 9.99€ per year per device and 29.99€ per year per device. So change the values and add a year counter for renewal. Include in the license data the license expiry date

## About tab

Create a tab called About that should be aligned right, the about tab should contain, the application name, the version, the link for the privacy and disclaimer documents.
If the application is licensed should show a green label saying its licensed and its serial number.
Should also say that for issues should use the https://github.com/carlosgalveias/vulnsweep-releases/issues

## LICENSE BACKUP / RESTORE

In case we need to , lets say , format the computer and reinstall things. We may need to have a way to restore the already paid license. So if the application has a valid license, add a backup button that should create a zip file of the encrypted data for the license. Now keep in mind that we are having a special crafted and hidden marker to get the date of creation as a key for the sludge-crypt module. We must make sure that backing saves that file and restore recreates that file with exactly the same marker date without the user seeing it. So find creative ways to backup into a single encoded file all the necessary things to restore to the exact same state

## Usage analitycs

Lets use Aptabase, that is free until 15000 events per day, I want to track application initialization, repository scans, sbom generation, dependency updates, vulnerabilities fixed by severity and paypal sucess purshases.  
The app key is 'A-EU-9601263447'. User should be able to opt-out of the usage collection in the about section.

# The team

You are the project lead and your role is to manage the correct distribution of tasks and track progress and successes along the way.
So you need to create a task list of these implementations, and track their progress, you can count on the team as well to define the actual list of tasks necessary to be done per item, here are your team:

### Ask:

The mode that will allow you to get information on existing code base

### Arquitect:

The main applicaton arquitect that will generate the proper requirements for each implmentation

### Code Pathologist:

His role is the 'devils advocate' , he is meant to catch what others dont see, so use him to iterate with the Arquitect to make sure he didnt missed anything in the arquitectural decisions, use him to code review and make sure he has a functional logical approach to the implementation and not only a technical one. So he reviews arquitectural decisions, he reviews code, he reviews tests,etc.

### Javascript Expert:

He is an elite javascript coder and that implements all the necessary changes dictated by the team

### Algorithmic Alchemist:

Responsible for updating any marketing documentation of any new feature implemented

### The Visual Syntax Engineer:

Responsible for the UI/UX of the tool

# Workflow

1. First step is for you to get information regarding what the tool does and then pass the information to the arquitect to generate a full task list. The arquitect should produce the necessary low level tasks necessary for the implementation.
2. that recomendation should then be reviewed by the code pathologist, he needs to be critical and do not let any over engineering or lack of logic happen. We must be very careful if we really are following the necessary functionality. If the code pathologist has comments, you should then direct them back to the arquitect , it eveything is ok in the code pathologist eyes, then proceed
3. the arquitect should then provide you with the arquitecture decisions for the necessary implementations
4. You create the sprint-2-detailed task list based on the requirements and low level tasks described by the arquitect
5. You iterate through each task coordinating the teams for code change, code review, tests implemented and documentation update (if necessary) keeping track of progress.

# Constraints

## We are using windows as OS , so no linux commands will work

## Long writes probably will need to be split, use methods of creating temperary files and then concat them

## Clean up after what you used

## For temporary scripts and files do NOT USE SCRIPTS FOLDER, use tmp folder

# Deliverables

Your responsability is to deliver all tasks implemented , tested and documented including any marketing or legal information
