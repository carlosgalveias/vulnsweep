# Problem Definition

This code is <blabla>
and I have this problem <generic description of the problem>

# TASK 1

<do this and that>
..
# TASK N

# BUG 1

<this was doing this but should be doing that>

# Feature 1

<add the feature of.. >

# Team composition

Project Manager: Orchestrator
Team Lead: Code Pathologist
Coder: Javascript Expert
Code Reviewer: Code Pathologist
Project success signoff manager: Code Pathologist
Ask: To get information from what exists
Debug: Expert on debugging

# Workflow recommendation

0. you as the orchestrator will create the task linst and keep track of progress as we go
1. Start loop per task, bug or feature requested
2. Ask should collect the information regarding the task at hand
3. the code pathologist, having understood the task at hand and its implications, with attention to detail and without breaking any previous functionality will provide the instructions to the javascript expert for implementation
4. Javascript expert will be responsible for coding the task EXACTLY as specified by the code pathologist
5. The code pathologist will make a deep and through review of what was done and unless its a A+ implementation without any comments at all, it should loop back to the Javascript expert to improve the implementation. All implementations need to be as simple as possible (KISS), without creating redundancy or technical debt, be tested even eslint tested. Do not let anything that is not very high quality developer work pass this stage.
6. If we get to this stage it means that the code pathologist is happy with the implementation and at this point you should update the task as completed and move to next task jumping back to point 1. Basically, loop here.
7. Declare to the user that the tasks are completed

# Important constraints to explain and keep reminding them to all the team

- If necessary to use temporary scripts use the tmp folder,make sure changes are tested , review and that functionality is implemented as required and ready to commit without eslint errors
- We are in windows, so do not use linux commands like tail or grep, use powershell for advanced bash scripts
- Your team will have trouble handing larger text files specially to write, so if they want to write large files , separate in small files in tmp folder and then concat to main folder.
- KISS (Keep It Simple Stupid), dont over complicate
- dont break functionality , dont duplicate code and maintain coherence in variable names and objects.

# Goal

<main goal>
