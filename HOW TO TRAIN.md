The current default trains holding near an already aimed pose, while Policy Test starts at 90° / 90°. That jump can be too difficult. A policy that learns to hold may stay still when tested away from the target.

Use this process to establish measurable improvement first:
1. Refresh the page and initialize the environment.
   This loads the corrected joint-angle measurements. Start with a fresh policy; checkpoints from before that fix are incompatible.
2. Record the aiming angles from Event Stream.
   Find the line “Visible aiming pose: … degrees.” These are the pan and tilt angles for the current target.
3. Establish a before-training test.
   Train one small batch—1 update × 64 steps—to create a policy. Enter the aiming angles in Test Policy, then run it. Record the outcome, hold time, return and action counts. This is your initial comparison.
4. Train the easy holding task.
   Select:
   - Configured target / near startup angles
   - Warm start: ON
   - 20 updates
   - 256 steps per rollout
   That collects 5,120 action steps. Allow the run to finish.
5. Repeat exactly the same policy test.
   Use the same aiming angles as step 3. Look for a successful acquisition, increased hold time, or better return. Staying still is correct here if it keeps the sensor on the target.
6. Test small offsets.
   Move the starting pan angle about 2° away from the aiming pose, keeping within the joint limits. Repeat with tilt. The policy should eventually correct the offset and acquire the target. Save a checkpoint when this works consistently.
7. Only then attempt ordinary-start search.
   Turn Warm start OFF, keep the near-startup stage, and train in batches of 20 updates × 512 steps = 10,240 steps. Evaluate between batches using all five held-out cases.
8. Stop and diagnose if several batches show no improvement.
   Check the action counts:
   - All Hold: the policy has settled on staying still.
   - Repeated movement plus clipped actions: it is pushing into a joint limit.
   - Movement without acquisition: it is exploring or following an ineffective behavior.
Important limitation: the trainer currently has no gradual curriculum between “almost aimed at the target” and “starting around 90° / 90°.” More iterations alone may not bridge that gap. The steps above can demonstrate holding improvement; reliable target search may require implementing that intermediate curriculum.