Refer to Gradient Calculation\LAZ_to_Gradient_Guide.md, docs\openrouter-deepseek-gradient-runbook.md, and .clinerules\gradient-runner.md as well as CLAUDE.md

Your ultimate goal is to obtain a gradient set from the given roads. Though recommended, you need not follow absolutely everything in the 3 documents above. If you come across a more efficient or accurate way to work, feel free to adapt to that. 

To start, we will calibrate based on existing data.

SERANGOON AVENUE 3
BOUNDARY ROAD
ANG MO KIO INDUSTRIAL PARK 2
UPPER PAYA LEBAR ROAD

Obtain the gradient for these, do not copy it directly from the final data. Adjust your parameters and methods until the roads you do are accurate to what exists.

Last, once calibrated, you are good to start. Work on these roads in Sengkang once you're done.

MOUNT SINAI PLAIN
MOUNT SINAI RISE
MOUNT SINAI VIEW
MOUNT SINAI WALK
NAMLY AVENUE
NAMLY CLOSE
NAMLY CRESCENT
NAMLY DRIVE
NAMLY GARDEN
NAMLY GROVE
NAMLY HILL
NAMLY PLACE
NAMLY RISE
NAMLY VIEW
OAK AVENUE
OEI TIONG HAM PARK
OLD HOLLAND ROAD
ORIOLE CRESCENT
PANDAN VALLEY
PARK VALE
PEI WAH AVENUE
PINE GROVE
PINE WALK
PRINCE OF WALES ROAD
PRINCE ROAD
PRINCESS OF WALES ROAD
QUEEN ASTRID GARDENS
QUEEN ASTRID PARK
QUEEN'S ROAD
REBECCA ROAD
REDWOOD AVENUE
RIDGEWOOD CLOSE
RIFLE RANGE ROAD
SECOND AVENUE
SERVICE ROAD
SHAMAH TERRACE
SHELFORD ROAD
SIAN TUAN AVENUE
SIME PARK DRIVE
SIME PARK HILL
SIME ROAD


Refer to Gradient Calculation\LAZ_to_Gradient_Guide.md, docs\openrouter-deepseek-gradient-runbook.md, and .clinerules\gradient-runner.md

Normally, your job is to run gradients. However, in this case, I simply want you to create a txt with two columns; Name, and Priority.

Priority is determined by category of road and other factors, but in our case, priority only affects the order in which i process, so it's honestly pretty unimportant. Just give a guess. 

Let's start. I need every road in AMK. 
