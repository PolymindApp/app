# Tracking insights

The factor selector groups device-derived wellbeing data under **Health Connect**. Steps are read as daily aggregates from Health Connect. Screen time is measured from Android screen-interactive usage events and requires Usage Access because Health Connect does not define a screen-time record.

Both device factors are quantitative. Insights load one value per local calendar day in the selected range, use `steps` and `minutes` as their respective units, and refresh the current day's cached value after one minute.
