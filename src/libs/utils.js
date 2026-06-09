export async function calcSubjectPts(comment, personalValues, increment) {
  let subjectPts = JSON.parse(JSON.stringify(comment.subjectPts));

  for (let subject of personalValues) {
    const found = subjectPts.find((c) => c.subjectId === subject.subjectId);
    if (found) {
      if (increment)
        subjectPts[subjectPts.indexOf(found)] = {
          ...found,
          value: (found.value += subject.value),
        };
      else
        subjectPts[subjectPts.indexOf(found)] = {
          ...found,
          value: (found.value -= subject.value),
        };
    } else {
      subjectPts.push({ ...subject, userLikes: [], userDislikes: [] });
    }
  }
  return subjectPts;
}

export async function calcSubjectCount(subjects, personalValues, add, userId) {
  let newSubjects = JSON.parse(JSON.stringify(subjects));

  for (let subject of personalValues) {
    const found = newSubjects.find((c) => c.subjectId === subject.subjectId);
    if (found) {
      if (add) {
        newSubjects[newSubjects.indexOf(found)] = {
          ...found,
          userLikes:
            subject.value === 1
              ? [...found.userLikes, userId]
              : found.userLikes,
          userDislikes:
            subject.value === -1
              ? [...found.userDislikes, userId]
              : found.userDislikes,
        };
        // console.log("increment this: ", newSubjects[newSubjects.indexOf(found)]);
      } else {
        newSubjects[newSubjects.indexOf(found)] = {
          ...found,
          userLikes:
            subject.value === 1
              ? found.userLikes.filter((x) => x !== userId)
              : found.userLikes,
          userDislikes:
            subject.value === -1
              ? found.userLikes.filter((x) => x !== userId)
              : found.userDislikes,
        };
        // console.log("decrement this: ", newSubjects[newSubjects.indexOf(found)]);
      }
    } else {
      console.log("how the frick did it end up here");
    }
  }
  return newSubjects;
}
