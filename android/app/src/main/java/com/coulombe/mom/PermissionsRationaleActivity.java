package dev.coulombe.mom;

import android.graphics.Color;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;

public class PermissionsRationaleActivity extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(padding, padding, padding, padding);
        content.setBackgroundColor(Color.rgb(16, 19, 16));

        TextView title = new TextView(this);
        title.setText("Health Connect and your steps");
        title.setTextColor(Color.WHITE);
        title.setTextSize(24);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        content.addView(title);

        TextView body = new TextView(this);
        body.setText(
            "Polymind reads aggregated step totals from Health Connect only after you grant permission. "
                + "Those totals are used to calculate progress for your step-counter tasks. "
                + "Polymind does not write step data to Health Connect. You can revoke access at any time "
                + "from Health Connect settings."
        );
        body.setTextColor(Color.rgb(190, 196, 190));
        body.setTextSize(16);
        body.setLineSpacing(0, 1.25f);
        LinearLayout.LayoutParams bodyParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        bodyParams.topMargin = padding;
        content.addView(body, bodyParams);

        Button done = new Button(this);
        done.setText("Done");
        done.setOnClickListener(view -> finish());
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        buttonParams.topMargin = padding;
        content.addView(done, buttonParams);

        ScrollView scrollView = new ScrollView(this);
        scrollView.addView(content);
        setContentView(scrollView);
    }
}
